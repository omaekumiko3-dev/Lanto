// Lanto's application tunnel uses the upstream WireGuard protocol and userspace
// network stack. It forwards only Lanto and Sunshine ports, never an IP network.
package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/tun/netstack"
)

const version = "1"

var tcpPorts = []int{47984, 47989, 48010, 48199}
var udpPorts = []int{47998, 47999, 48000, 48002, 48010}
var hostIP = netip.MustParseAddr("10.203.0.1")

type Peer struct {
	PublicKey string `json:"publicKey"`
	Address   string `json:"address"`
	Endpoint  string `json:"endpoint,omitempty"`
}
type Config struct {
	Version     int    `json:"version"`
	Role        string `json:"role"`
	PrivateKey  string `json:"privateKey"`
	Address     string `json:"address"`
	ListenPort  int    `json:"listenPort"`
	BindAddress string `json:"bindAddress,omitempty"`
	Peers       []Peer `json:"peers"`
}

func keyHex(key string) (string, error) {
	value, err := base64.StdEncoding.Strict().DecodeString(key)
	if err != nil || len(value) != 32 || key != base64.StdEncoding.EncodeToString(value) {
		return "", errors.New("invalid key")
	}
	zero := true
	for _, b := range value {
		zero = zero && b == 0
	}
	if zero {
		return "", errors.New("empty key")
	}
	return hex.EncodeToString(value), nil
}
func tunnelAddress(value string) (netip.Addr, error) {
	address, err := netip.ParseAddr(value)
	if err != nil || !address.Is4() || !netip.MustParsePrefix("10.203.0.0/16").Contains(address) {
		return netip.Addr{}, errors.New("invalid tunnel address")
	}
	return address, nil
}
func (c Config) validate() error {
	address, err := tunnelAddress(c.Address)
	if err != nil || c.Version != 1 || (c.Role != "host" && c.Role != "client") || c.ListenPort < 0 || c.ListenPort > 65535 {
		return errors.New("invalid configuration")
	}
	if _, err = keyHex(c.PrivateKey); err != nil {
		return err
	}
	if c.Role == "host" && (address != hostIP || c.ListenPort == 0 || c.BindAddress != "") {
		return errors.New("invalid host configuration")
	}
	if c.Role == "client" {
		bind, err := netip.ParseAddr(c.BindAddress)
		if err != nil || !bind.Is4() || !bind.IsLoopback() || address == hostIP || len(c.Peers) != 1 {
			return errors.New("invalid client configuration")
		}
	}
	if len(c.Peers) < 1 || len(c.Peers) > 64 {
		return errors.New("invalid peer count")
	}
	addresses, keys := map[string]bool{}, map[string]bool{}
	for _, p := range c.Peers {
		peerIP, err := tunnelAddress(p.Address)
		if err != nil || peerIP == address || addresses[p.Address] || keys[p.PublicKey] {
			return errors.New("invalid peer")
		}
		if _, err = keyHex(p.PublicKey); err != nil {
			return err
		}
		if c.Role == "client" && (peerIP != hostIP || p.Endpoint == "") {
			return errors.New("missing endpoint")
		}
		if c.Role == "host" && p.Endpoint != "" {
			return errors.New("host endpoints are learned from authenticated packets")
		}
		if p.Endpoint != "" {
			host, portText, err := net.SplitHostPort(p.Endpoint)
			port, parseErr := strconv.Atoi(portText)
			if err != nil || parseErr != nil || port < 1 || port > 65535 || host == "" || strings.ContainsAny(host, "\r\n\x00 /\\") {
				return errors.New("invalid endpoint")
			}
		}
		addresses[p.Address], keys[p.PublicKey] = true, true
	}
	return nil
}

type Tunnel struct {
	device  *device.Device
	network *netstack.Net
	ctx     context.Context
	cancel  context.CancelFunc
	mu      sync.Mutex
	closers []io.Closer
}

func newTunnel(parent context.Context, config Config) (*Tunnel, error) {
	if err := config.validate(); err != nil {
		return nil, err
	}
	tun, network, err := netstack.CreateNetTUN([]netip.Addr{netip.MustParseAddr(config.Address)}, nil, 1420)
	if err != nil {
		return nil, errors.New("network stack unavailable")
	}
	// Use Go's dual-stack UDP sockets on every platform. This helper does not
	// manage OS interfaces and does not need Windows' interface-oriented RIO bind.
	dev := device.NewDevice(tun, conn.NewStdNetBind(), device.NewLogger(device.LogLevelSilent, ""))
	private, _ := keyHex(config.PrivateKey)
	uapi := "private_key=" + private + "\nlisten_port=" + strconv.Itoa(config.ListenPort) + "\nreplace_peers=true\n"
	for _, p := range config.Peers {
		public, _ := keyHex(p.PublicKey)
		uapi += "public_key=" + public + "\nallowed_ip=" + p.Address + "/32\n"
		if p.Endpoint != "" {
			endpoint, err := net.ResolveUDPAddr("udp", p.Endpoint)
			if err != nil {
				dev.Close()
				return nil, errors.New("endpoint could not be resolved")
			}
			uapi += "endpoint=" + endpoint.String() + "\npersistent_keepalive_interval=25\n"
		}
	}
	if err := dev.IpcSet(uapi); err != nil {
		dev.Close()
		return nil, errors.New("tunnel configuration rejected")
	}
	if err := dev.Up(); err != nil {
		dev.Close()
		return nil, errors.New("UDP listener unavailable")
	}
	ctx, cancel := context.WithCancel(parent)
	t := &Tunnel{device: dev, network: network, ctx: ctx, cancel: cancel}
	go func() {
		<-ctx.Done()
		t.mu.Lock()
		for _, c := range t.closers {
			c.Close()
		}
		t.closers = nil
		t.mu.Unlock()
		dev.Close()
	}()
	return t, nil
}
func (t *Tunnel) own(c io.Closer) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.ctx.Err() != nil {
		c.Close()
	} else {
		t.closers = append(t.closers, c)
	}
}
func (t *Tunnel) close() { t.cancel() }

func bridge(ctx context.Context, a, b net.Conn) {
	defer a.Close()
	defer b.Close()
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			a.Close()
			b.Close()
		case <-done:
		}
	}()
	defer close(done)
	var wg sync.WaitGroup
	wg.Add(2)
	copyHalf := func(dst, src net.Conn) {
		defer wg.Done()
		_, _ = io.Copy(dst, src)
		if half, ok := dst.(interface{ CloseWrite() error }); ok {
			half.CloseWrite()
		} else {
			dst.Close()
		}
	}
	go copyHalf(a, b)
	go copyHalf(b, a)
	wg.Wait()
}
func serveTCP(ctx context.Context, listener net.Listener, dial func(context.Context) (net.Conn, error)) {
	limit := make(chan struct{}, 64)
	for {
		client, err := listener.Accept()
		if err != nil {
			return
		}
		select {
		case limit <- struct{}{}:
		default:
			client.Close()
			continue
		}
		go func() {
			defer func() { <-limit }()
			bounded, cancel := context.WithTimeout(ctx, 10*time.Second)
			target, err := dial(bounded)
			cancel()
			if err != nil {
				client.Close()
				return
			}
			bridge(ctx, client, target)
		}()
	}
}

// Each UDP source gets its own socket so replies retain their destination. Only
// authenticated tunnel peers can reach the host side; idle mappings are bounded.
func serveUDP(ctx context.Context, listener net.PacketConn, dial func() (net.Conn, error)) {
	type mapping struct {
		socket net.Conn
		last   time.Time
	}
	var mu sync.Mutex
	mappings := map[string]*mapping{}
	defer func() {
		mu.Lock()
		defer mu.Unlock()
		for _, m := range mappings {
			m.socket.Close()
		}
	}()
	buf := make([]byte, 65535)
	for {
		n, source, err := listener.ReadFrom(buf)
		if err != nil {
			return
		}
		if n == 0 {
			continue
		}
		key := source.String()
		mu.Lock()
		m := mappings[key]
		if m == nil {
			if len(mappings) >= 128 {
				mu.Unlock()
				continue
			}
			socket, err := dial()
			if err != nil {
				mu.Unlock()
				continue
			}
			m = &mapping{socket: socket, last: time.Now()}
			mappings[key] = m
			go func(source net.Addr, key string, m *mapping) {
				defer func() {
					m.socket.Close()
					mu.Lock()
					if mappings[key] == m {
						delete(mappings, key)
					}
					mu.Unlock()
				}()
				response := make([]byte, 65535)
				for {
					m.socket.SetReadDeadline(time.Now().Add(60 * time.Second))
					n, err := m.socket.Read(response)
					if err != nil {
						if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
							mu.Lock()
							idle := time.Since(m.last) > 60*time.Second
							mu.Unlock()
							if !idle && ctx.Err() == nil {
								continue
							}
						}
						return
					}
					if _, err = listener.WriteTo(response[:n], source); err != nil {
						return
					}
				}
			}(source, key, m)
		}
		m.last = time.Now()
		mu.Unlock()
		m.socket.SetWriteDeadline(time.Now().Add(3 * time.Second))
		_, _ = m.socket.Write(buf[:n])
	}
}

func (t *Tunnel) startForwarding(config Config) error {
	for _, port := range tcpPorts {
		var listener net.Listener
		var err error
		var dial func(context.Context) (net.Conn, error)
		if config.Role == "client" {
			listener, err = net.Listen("tcp4", net.JoinHostPort(config.BindAddress, strconv.Itoa(port)))
			dial = func(ctx context.Context) (net.Conn, error) {
				return t.network.DialContext(ctx, "tcp", net.JoinHostPort(hostIP.String(), strconv.Itoa(port)))
			}
		} else {
			listener, err = t.network.ListenTCPAddrPort(netip.AddrPortFrom(hostIP, uint16(port)))
			dial = func(ctx context.Context) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
			}
		}
		if err != nil {
			return errors.New("a TCP forwarding port is unavailable")
		}
		t.own(listener)
		go serveTCP(t.ctx, listener, dial)
	}
	for _, port := range udpPorts {
		var listener net.PacketConn
		var err error
		var dial func() (net.Conn, error)
		if config.Role == "client" {
			listener, err = net.ListenPacket("udp4", net.JoinHostPort(config.BindAddress, strconv.Itoa(port)))
			dial = func() (net.Conn, error) {
				return t.network.DialUDPAddrPort(netip.AddrPort{}, netip.AddrPortFrom(hostIP, uint16(port)))
			}
		} else {
			listener, err = t.network.ListenUDPAddrPort(netip.AddrPortFrom(hostIP, uint16(port)))
			dial = func() (net.Conn, error) { return net.Dial("udp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port))) }
		}
		if err != nil {
			return errors.New("a UDP forwarding port is unavailable")
		}
		t.own(listener)
		go serveUDP(t.ctx, listener, dial)
	}
	return nil
}
func (t *Tunnel) handshake() int64 {
	state, err := t.device.IpcGet()
	if err != nil {
		return 0
	}
	var latest int64
	scanner := bufio.NewScanner(strings.NewReader(state))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "last_handshake_time_sec=") {
			value, _ := strconv.ParseInt(strings.TrimPrefix(line, "last_handshake_time_sec="), 10, 64)
			if value > latest {
				latest = value
			}
		}
	}
	return latest
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--version" {
		fmt.Println("lanto-tunnel " + version)
		return
	}
	input := io.Reader(os.Stdin)
	fromFile := false
	if len(os.Args) == 3 && os.Args[1] == "--config" {
		file, err := os.Open(os.Args[2])
		if err != nil {
			fmt.Fprintln(os.Stderr, "Cannot read tunnel configuration")
			os.Exit(1)
		}
		defer file.Close()
		input = file
		fromFile = true
	} else if len(os.Args) != 1 {
		fmt.Fprintln(os.Stderr, "Invalid tunnel arguments")
		os.Exit(1)
	}
	decoder := json.NewDecoder(io.LimitReader(input, 128*1024))
	decoder.DisallowUnknownFields()
	var config Config
	if err := decoder.Decode(&config); err != nil {
		fmt.Fprintln(os.Stderr, "Invalid tunnel configuration")
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	t, err := newTunnel(ctx, config)
	if err == nil {
		err = t.startForwarding(config)
	}
	if err != nil {
		if t != nil {
			t.close()
		}
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
	defer t.close()
	if !fromFile {
		go func() { io.Copy(io.Discard, input); stop() }()
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.Encode(map[string]any{"event": "ready", "version": 1})
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	var last int64
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			now := t.handshake()
			if now != last {
				last = now
				encoder.Encode(map[string]any{"event": "handshake", "at": now})
			}
		}
	}
}
