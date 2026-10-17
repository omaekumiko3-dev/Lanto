package main

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"io"
	"net"
	"net/netip"
	"strconv"
	"testing"
	"time"
)

func keys(t *testing.T) (string, string) {
	t.Helper()
	key, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(key.Bytes()), base64.StdEncoding.EncodeToString(key.PublicKey().Bytes())
}
func freeUDP(t *testing.T) int {
	t.Helper()
	s, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	port := s.LocalAddr().(*net.UDPAddr).Port
	s.Close()
	return port
}
func pair(t *testing.T) (*Tunnel, *Tunnel) {
	return pairEndpoint(t, "127.0.0.1")
}
func pairEndpoint(t *testing.T, endpoint string) (*Tunnel, *Tunnel) {
	t.Helper()
	a, ap := keys(t)
	b, bp := keys(t)
	port := freeUDP(t)
	host, err := newTunnel(context.Background(), Config{Version: 1, Role: "host", PrivateKey: a, Address: hostIP.String(), ListenPort: port, Peers: []Peer{{PublicKey: bp, Address: "10.203.0.2"}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(host.close)
	client, err := newTunnel(context.Background(), Config{Version: 1, Role: "client", PrivateKey: b, Address: "10.203.0.2", BindAddress: "127.0.0.2", Peers: []Peer{{PublicKey: ap, Address: hostIP.String(), Endpoint: net.JoinHostPort(endpoint, strconv.Itoa(port))}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.close)
	return host, client
}

func TestEncryptedTCPAndUDP(t *testing.T) {
	host, client := pair(t)
	echo, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer echo.Close()
	go func() {
		for {
			c, err := echo.Accept()
			if err != nil {
				return
			}
			go func() { defer c.Close(); io.Copy(c, c) }()
		}
	}()
	remote, err := host.network.ListenTCPAddrPort(netip.AddrPortFrom(hostIP, 35001))
	if err != nil {
		t.Fatal(err)
	}
	host.own(remote)
	go serveTCP(host.ctx, remote, func(ctx context.Context) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", echo.Addr().String())
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	connection, err := client.network.DialContext(ctx, "tcp", "10.203.0.1:35001")
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	connection.SetDeadline(time.Now().Add(5 * time.Second))
	message := []byte("Lanto authenticated TCP \xe2\x98\x83")
	if _, err := connection.Write(message); err != nil {
		t.Fatal(err)
	}
	got := make([]byte, len(message))
	if _, err := io.ReadFull(connection, got); err != nil {
		t.Fatal(err)
	}
	if string(got) != string(message) {
		t.Fatal("TCP payload changed")
	}
	udp, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer udp.Close()
	go func() {
		b := make([]byte, 65535)
		for {
			n, a, e := udp.ReadFrom(b)
			if e != nil {
				return
			}
			udp.WriteTo(b[:n], a)
		}
	}()
	remoteUDP, err := host.network.ListenUDPAddrPort(netip.AddrPortFrom(hostIP, 35002))
	if err != nil {
		t.Fatal(err)
	}
	host.own(remoteUDP)
	go serveUDP(host.ctx, remoteUDP, func() (net.Conn, error) { return net.Dial("udp4", udp.LocalAddr().String()) })
	dgrams, err := client.network.DialUDPAddrPort(netip.AddrPort{}, netip.AddrPortFrom(hostIP, 35002))
	if err != nil {
		t.Fatal(err)
	}
	defer dgrams.Close()
	dgrams.SetDeadline(time.Now().Add(5 * time.Second))
	for i := 0; i < 100; i++ {
		payload := make([]byte, 1200)
		rand.Read(payload)
		if _, err = dgrams.Write(payload); err != nil {
			t.Fatal(err)
		}
		reply := make([]byte, 1500)
		n, e := dgrams.Read(reply)
		if e != nil {
			t.Fatal(e)
		}
		if string(reply[:n]) != string(payload) {
			t.Fatal("UDP payload changed")
		}
	}
	if host.handshake() == 0 || client.handshake() == 0 {
		t.Fatal("authenticated handshake missing")
	}
}

func TestWrongKeyCannotOpenTunnel(t *testing.T) {
	a, ap := keys(t)
	b, _ := keys(t)
	_, different := keys(t)
	port := freeUDP(t)
	host, err := newTunnel(context.Background(), Config{Version: 1, Role: "host", PrivateKey: a, Address: hostIP.String(), ListenPort: port, Peers: []Peer{{PublicKey: different, Address: "10.203.0.2"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer host.close()
	client, err := newTunnel(context.Background(), Config{Version: 1, Role: "client", PrivateKey: b, Address: "10.203.0.2", BindAddress: "127.0.0.2", Peers: []Peer{{PublicKey: ap, Address: hostIP.String(), Endpoint: net.JoinHostPort("127.0.0.1", strconv.Itoa(port))}}})
	if err != nil {
		t.Fatal(err)
	}
	defer client.close()
	listener, err := host.network.ListenTCPAddrPort(netip.AddrPortFrom(hostIP, 35003))
	if err != nil {
		t.Fatal(err)
	}
	host.own(listener)
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	connection, err := client.network.DialContext(ctx, "tcp", "10.203.0.1:35003")
	if err == nil {
		connection.Close()
		t.Fatal("untrusted peer connected")
	}
	if host.handshake() != 0 {
		t.Fatal("untrusted handshake accepted")
	}
}

func TestConfigurationNeverExposesAnArbitraryProxy(t *testing.T) {
	a, _ := keys(t)
	_, bp := keys(t)
	base := Config{Version: 1, Role: "client", PrivateKey: a, Address: "10.203.0.2", BindAddress: "127.0.0.2", Peers: []Peer{{PublicKey: bp, Address: "10.203.0.1", Endpoint: "[2001:db8::1]:48200"}}}
	if err := base.validate(); err != nil {
		t.Fatal(err)
	}
	for _, bind := range []string{"0.0.0.0", "192.168.1.1", "::"} {
		c := base
		c.BindAddress = bind
		if c.validate() == nil {
			t.Fatal("non-loopback proxy allowed")
		}
	}
	c := base
	c.Address = "10.0.0.1"
	if c.validate() == nil {
		t.Fatal("foreign network address allowed")
	}
	c = base
	c.Peers = append(c.Peers, c.Peers[0])
	if c.validate() == nil {
		t.Fatal("duplicate peer allowed")
	}
}

func TestIPv6OuterTransport(t *testing.T) {
	probe, err := net.ListenUDP("udp6", &net.UDPAddr{IP: net.ParseIP("::1")})
	if err != nil {
		t.Skip("IPv6 loopback is unavailable")
	}
	probe.SetReadDeadline(time.Now().Add(time.Second))
	sender, err := net.DialUDP("udp6", nil, probe.LocalAddr().(*net.UDPAddr))
	if err != nil {
		probe.Close()
		t.Skip("IPv6 UDP is unavailable")
	}
	sender.Write([]byte("ipv6-available"))
	buffer := make([]byte, 64)
	_, _, err = probe.ReadFromUDP(buffer)
	sender.Close()
	probe.Close()
	if err != nil {
		t.Skip("IPv6 UDP is blocked by this machine's network configuration")
	}
	host, client := pairEndpoint(t, "::1")
	listener, err := host.network.ListenTCPAddrPort(netip.AddrPortFrom(hostIP, 35004))
	if err != nil {
		t.Fatal(err)
	}
	host.own(listener)
	go func() {
		c, err := listener.Accept()
		if err == nil {
			defer c.Close()
			c.Write([]byte("IPv6 direct"))
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, err := client.network.DialContext(ctx, "tcp", "10.203.0.1:35004")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.SetReadDeadline(time.Now().Add(5 * time.Second))
	response, err := io.ReadAll(c)
	if err != nil {
		t.Fatal(err)
	}
	if string(response) != "IPv6 direct" {
		t.Fatal("IPv6 payload changed")
	}
}
