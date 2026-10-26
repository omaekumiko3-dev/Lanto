#include "../moonlight/key-releases.h"
#include "../moonlight/physical-keys.h"
#include <cassert>
#include <cstdio>
#include <set>
#include <vector>

struct Transport {
    int capacity = 1000;
    std::set<std::uint32_t> held;
    std::vector<std::pair<std::uint32_t, bool>> delivered;
    int send(std::uint32_t key, bool down) {
        if (!capacity) return 2; // moonlight-common-c: LBQ_BOUND_EXCEEDED
        --capacity;
        if (down) held.insert(key); else held.erase(key);
        delivered.emplace_back(key, down);
        return 0;
    }
};

int main() {
    constexpr std::uint32_t W = 0x8057, N = 0x804e;
    for (std::uint32_t key : {W, N}) {
        for (int cycle = 0; cycle < 500; ++cycle) {
            Transport transport;
            LantoKeyReleases state;
            assert(state.send(key, true, [&] { return transport.send(key, true); }));
            transport.capacity = 0;
            assert(!state.send(key, false, [&] { return transport.send(key, false); }));
            assert(state.size() == 1 && state.pending() == 1 && transport.held.count(key));
            for (int attempt = 0; attempt < 5; ++attempt)
                state.retry([&](auto value) { return transport.send(value, false); });
            assert(state.size() == 1 && state.pending() == 1);
            transport.capacity = 1;
            state.retry([&](auto value) { return transport.send(value, false); });
            assert(state.empty() && state.pending() == 0 && transport.held.empty());
        }
    }
    Transport transport;
    LantoKeyReleases state;
    for (auto key : {W, N}) state.send(key, true, [&] { return transport.send(key, true); });
    // Repeated polling never cuts off a legitimate long hold.
    for (int i = 0; i < 10000; ++i)
        state.retry([&](auto key) { return transport.send(key, false); });
    assert(transport.delivered.size() == 2 && transport.held.size() == 2);
    transport.capacity = 0;
    state.releaseAll([&](auto key) { return transport.send(key, false); });
    assert(state.size() == 2 && state.pending() == 2);
    // Local mode or lost focus must keep retrying the release, without a new keypress.
    transport.capacity = 1;
    state.retry([&](auto key) { return transport.send(key, false); });
    assert(state.size() == 1 && state.pending() == 1);
    transport.capacity = 1;
    state.retry([&](auto key) { return transport.send(key, false); });
    assert(state.empty() && transport.held.empty());
    // A failed keydown was never held by the host and must not be replayed later.
    transport.capacity = 0;
    assert(!state.send(W, true, [&] { return transport.send(W, true); }));
    assert(state.empty() && state.pending() == 0);
    // An old failed release cannot break a subsequent physical hold of the same key.
    transport.capacity = 1;
    state.send(W, true, [&] { return transport.send(W, true); });
    state.send(W, false, [&] { return transport.send(W, false); });
    state.send(W, true, [&] { return transport.send(W, true); });
    assert(state.size() == 1 && state.pending() == 0);
    transport.capacity = 1;
    state.retry([&](auto key) { return transport.send(key, false); });
    assert(transport.held.count(W));
    state.send(W, false, [&] { return transport.send(W, false); });
    assert(state.empty() && transport.held.empty());
    assert(LantoKeyReleases::allowPress(true, true, true, false, true));
    assert(!LantoKeyReleases::allowPress(true, true, true, false, false));
    assert(!LantoKeyReleases::allowPress(true, true, false, false, true));
    assert(!LantoKeyReleases::allowPress(true, true, true, true, true));
    assert(LantoKeyReleases::allowPress(false, true, false, false, false));
    assert(LantoKeyReleases::allowPress(true, false, true, false, false));

    // Drop the SDL keyup entirely: the independent native release must settle it.
    constexpr std::uint32_t R = 0x8052;
    for (int cycle = 0; cycle < 1000; ++cycle) {
        LantoPhysicalKeys physical;
        LantoKeyReleases keys;
        Transport wire;
        auto release = [&](auto key) { return wire.send(key, false); };
        auto poll = [&] { keys.reconcile([&](auto hold) { return physical.released(hold); }, release); };
        physical.observe(0x13, false, true);
        keys.send(R, true, [&] { return wire.send(R, true); }, physical.hold(R));
        for (int i = 0; i < 10000; ++i) poll();
        assert(wire.held.count(R) && wire.delivered.size() == 1); // No hold timeout.
        physical.observe(0x13, false, false);
        wire.capacity = 0;
        poll();
        assert(keys.size() == 1 && keys.pending() == 1);
        wire.capacity = 1;
        poll();
        assert(keys.empty() && wire.held.empty());
        poll();
        assert(wire.delivered.size() == 2); // No repeated release after success.
    }
    {
        LantoPhysicalKeys physical;
        LantoKeyReleases keys;
        Transport wire;
        auto poll = [&] { keys.reconcile([&](auto hold) { return physical.released(hold); },
                                      [&](auto key) { return wire.send(key, false); }); };
        // Unknown hook state cannot release a legitimate hold.
        assert(!physical.hold(R));
        keys.send(R, true, [&] { return wire.send(R, true); }, physical.hold(R));
        physical.observe(0x13, false, false);
        poll(); assert(wire.held.count(R));
        keys.releaseAll([&](auto key) { return wire.send(key, false); });
        // Hook replacement invalidates old observations.
        physical.observe(0x13, false, true);
        keys.send(R, true, [&] { return wire.send(R, true); }, physical.hold(R));
        physical.reset();
        physical.observe(0x13, false, false);
        poll(); assert(wire.held.count(R));
        // A new physical press supersedes a rejected release for that same key.
        keys.releaseAll([&](auto key) { return wire.send(key, false); });
        physical.observe(0x13, false, true);
        keys.send(R, true, [&] { return wire.send(R, true); }, physical.hold(R));
        physical.observe(0x13, false, false);
        wire.capacity = 0; poll(); assert(keys.pending() == 1);
        physical.observe(0x13, false, true);
        keys.send(R, true, [&] { return wire.send(R, true); }, physical.hold(R));
        wire.capacity = 1; poll(); assert(wire.held.count(R) && !keys.pending());
        physical.observe(0x13, false, false);
        poll(); assert(keys.empty() && wire.held.empty());
    }
    {
        // Hardware scancodes, not layout-dependent VKs or NumLock aliases.
        LantoPhysicalKeys physical;
        physical.observe(0x11, false, true);
        const auto w = physical.hold(W);
        assert(w && !physical.hold(0x805a)); // Physical W is W even on AZERTY.
        physical.observe(0x11, false, false); assert(physical.released(w));
        physical.observe(0x1c, false, true);
        const auto enter = physical.hold(0x800d);
        assert(enter && !physical.hold(0x0080800d)); // Keypad Enter is distinct.
        physical.observe(0x1c, true, false); assert(!physical.released(enter));
        physical.observe(0x1c, false, false); assert(physical.released(enter));
        physical.observe(0x4f, false, true);
        const auto keypad = physical.hold(0x8061);
        assert(keypad && !physical.hold(0x00808023)); // Keypad 1 is not End.
        physical.observe(0x4f, true, false); assert(!physical.released(keypad));
        physical.observe(0x4f, false, false); assert(physical.released(keypad));
        assert(!physical.hold(0x01008052)); // Unknown normalization is not guessed.
        physical.observe(0x21d, false, true); // Synthetic AltGr scan is ignored.
        assert(!physical.hold(0x80a2));
    }
    std::puts("Key release tests passed: 1000 W/N backpressure cycles, 1000 missing-SDL-release recoveries, long holds, hook replacement, layout/extended-key isolation, new presses");
}
