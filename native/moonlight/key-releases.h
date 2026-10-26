#pragma once
#include <cstdint>
#include <map>
#include <set>

// A queued keydown belongs to the host until a matching keyup is queued too.
// Transport backpressure must not make us forget a key that the host still holds.
class LantoKeyReleases {
public:
    static bool allowPress(bool managed, bool locked, bool remote, bool switching, bool focused) {
        return !managed || !locked || (remote && !switching && focused);
    }

    template<class Submit>
    bool send(std::uint32_t key, bool down, Submit submit, std::uint64_t physicalHold = 0) {
        // A fresh physical press owns an already-held key; do not retry an old
        // release in the middle of that new hold.
        if (down) { m_Pending.erase(key); m_Physical.erase(key); }
        const bool accepted = submit() == 0;
        if (accepted) {
            if (down) m_Down.insert(key);
            else { m_Down.erase(key); m_Pending.erase(key); m_Physical.erase(key); }
        } else if (!down && m_Down.count(key)) {
            m_Pending.insert(key);
        }
        if (down && physicalHold && m_Down.count(key)) m_Physical[key] = physicalHold;
        return accepted;
    }

    template<class Released, class Release>
    void reconcile(Released released, Release release) {
        for (const auto& hold : m_Physical)
            if (released(hold.second)) m_Pending.insert(hold.first);
        retry(release);
    }

    template<class Release>
    void retry(Release release) {
        for (auto it = m_Pending.begin(); it != m_Pending.end();) {
            if (release(*it) != 0) break;
            m_Down.erase(*it);
            m_Physical.erase(*it);
            it = m_Pending.erase(it);
        }
    }

    template<class Release>
    void releaseAll(Release release) {
        m_Pending.insert(m_Down.begin(), m_Down.end());
        retry(release);
    }

    bool empty() const { return m_Down.empty(); }
    std::size_t size() const { return m_Down.size(); }
    std::size_t pending() const { return m_Pending.size(); }

private:
    std::set<std::uint32_t> m_Down;
    std::set<std::uint32_t> m_Pending;
    std::map<std::uint32_t, std::uint64_t> m_Physical;
};
