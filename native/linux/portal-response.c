// SPDX-License-Identifier: MIT
// Compatibility adapter for Sunshine's late XDG Portal Response subscription.
// Build as a Linux ELF shared library. No SDK headers are needed: these are the
// stable public GLib/GIO ABI declarations, not private object layouts.
typedef void *Ptr;
typedef unsigned long Size;
typedef unsigned int UInt;
typedef int Bool;
typedef void (*Notify)(Ptr);
typedef void (*Signal)(Ptr, const char *, const char *, const char *, const char *, Ptr, Ptr);
typedef Ptr (*Call)(Ptr, const char *, Ptr, int, int, Ptr, Ptr);
typedef UInt (*Subscribe)(Ptr, const char *, const char *, const char *, const char *, const char *,
                          int, Signal, Ptr, Notify);
extern Ptr dlsym(Ptr, const char *);
extern int strcmp(const char *, const char *);
extern int strncmp(const char *, const char *, Size);
extern Size strlen(const char *);
extern long write(int, const void *, Size);
extern long readlink(const char *, char *, Size);
extern Ptr g_malloc0(Size);
extern void g_free(Ptr);
extern char *g_strdup(const char *);
extern char *g_strdup_printf(const char *, ...);
extern Ptr g_object_ref(Ptr);
extern void g_object_unref(Ptr);
extern Ptr g_object_get_data(Ptr, const char *);
extern void g_object_set_data(Ptr, const char *, Ptr);
extern const char *g_dbus_proxy_get_interface_name(Ptr);
extern const char *g_dbus_proxy_get_name(Ptr);
extern char *g_dbus_proxy_get_name_owner(Ptr);
extern Ptr g_dbus_proxy_get_connection(Ptr);
extern const char *g_dbus_connection_get_unique_name(Ptr);
extern UInt g_dbus_connection_add_filter(Ptr, Ptr (*)(Ptr, Ptr, Bool, Ptr), Ptr, Notify);
extern void g_dbus_connection_signal_unsubscribe(Ptr, UInt);
extern int g_dbus_message_get_message_type(Ptr);
extern const char *g_dbus_message_get_interface(Ptr);
extern const char *g_dbus_message_get_member(Ptr);
extern const char *g_dbus_message_get_path(Ptr);
extern const char *g_dbus_message_get_sender(Ptr);
extern Ptr g_dbus_message_get_body(Ptr);
extern Ptr g_variant_ref(Ptr);
extern void g_variant_unref(Ptr);
extern Bool g_variant_is_of_type(Ptr, Ptr);
extern Ptr g_idle_source_new(void);
extern void g_source_set_priority(Ptr, int);
extern void g_source_set_callback(Ptr, Bool (*)(Ptr), Ptr, Notify);
extern UInt g_source_attach(Ptr, Ptr);
extern void g_source_unref(Ptr);
extern Ptr g_main_context_get_thread_default(void);

struct Cached {
    char *path, *sender;
    Ptr body;
};
struct Context {
    char *owner, *prefix;
    unsigned cursor;
    struct Cached cache[32];
};
struct Replay {
    Ptr connection;
    struct Cached value;
    Signal callback;
    Ptr data;
};
static volatile int locked;
static void lock(void) {
    while (__atomic_exchange_n(&locked, 1, 2))
        __asm__ volatile("pause");
}
static void unlock(void) { __atomic_store_n(&locked, 0, 3); }
static Bool equal(const char *a, const char *b) { return a && b && strcmp(a, b) == 0; }
static Bool target_process(void) {
#ifdef LANTO_TEST
    return 1;
#else
    // Service environment can be inherited by an application Sunshine launches.
    // Leave all such applications' GIO behavior unchanged.
    char path[4096];
    long size = readlink("/proc/self/exe", path, sizeof(path) - 1);
    if (size < 0 || size >= (long)sizeof(path) - 1)
        return 0;
    path[size] = 0;
    const char *name = path;
    for (const char *p = path; *p; ++p)
        if (*p == '/')
            name = p + 1;
    return equal(name, "sunshine");
#endif
}
static void clear(struct Cached *value) {
    if (value->body)
        g_variant_unref(value->body);
    g_free(value->path);
    g_free(value->sender);
    value->path = 0;
    value->sender = 0;
    value->body = 0;
}
static Ptr observe(Ptr connection, Ptr message, Bool incoming, Ptr data) {
    (void)connection;
    struct Context *ctx = data;
    if (!incoming || g_dbus_message_get_message_type(message) != 4 ||
        !equal(g_dbus_message_get_interface(message), "org.freedesktop.portal.Request") ||
        !equal(g_dbus_message_get_member(message), "Response"))
        return message;
    const char *path = g_dbus_message_get_path(message),
               *sender = g_dbus_message_get_sender(message);
    Ptr body = g_dbus_message_get_body(message);
    if (!path || !body || !g_variant_is_of_type(body, (Ptr) "(ua{sv})"))
        return message;
    lock();
    // A filter sees unicast responses before GIO discards unsubscribed signals.
    // Accept only this connection's request paths and the real portal owner.
    if (equal(sender, ctx->owner) && !strncmp(path, ctx->prefix, strlen(ctx->prefix))) {
        struct Cached *slot = &ctx->cache[ctx->cursor++ % 32];
        clear(slot);
        slot->path = g_strdup(path);
        slot->sender = g_strdup(sender);
        slot->body = g_variant_ref(body);
    }
    unlock();
    return message; // Never consume, edit, or inject a D-Bus message.
}
static void destroy_context(Ptr data) {
    struct Context *ctx = data;
    for (unsigned i = 0; i < 32; ++i)
        clear(&ctx->cache[i]);
    g_free(ctx->owner);
    g_free(ctx->prefix);
    g_free(ctx);
}
static void prepare(Ptr proxy) {
    if (!target_process())
        return;
    if (!equal(g_dbus_proxy_get_name(proxy), "org.freedesktop.portal.Desktop"))
        return;
    const char *interface = g_dbus_proxy_get_interface_name(proxy);
    if (!equal(interface, "org.freedesktop.portal.RemoteDesktop") &&
        !equal(interface, "org.freedesktop.portal.ScreenCast"))
        return;
    Ptr connection = g_dbus_proxy_get_connection(proxy);
    const char *unique = g_dbus_connection_get_unique_name(connection);
    char *owner = g_dbus_proxy_get_name_owner(proxy);
    if (!unique || !owner) {
        g_free(owner);
        return;
    }
    lock();
    struct Context *ctx = g_object_get_data(connection, "lanto-portal-response");
    if (!ctx) {
        ctx = g_malloc0(sizeof(*ctx));
        ctx->owner = owner;
        char *name = g_strdup(unique + 1);
        for (char *p = name; *p; ++p)
            if (*p == '.')
                *p = '_';
        ctx->prefix = g_strdup_printf("/org/freedesktop/portal/desktop/request/%s/", name);
        g_free(name);
        g_object_set_data(connection, "lanto-portal-response", ctx);
        g_dbus_connection_add_filter(connection, observe, ctx, destroy_context);
    } else {
        if (!equal(owner, ctx->owner)) {
            for (unsigned i = 0; i < 32; ++i)
                clear(&ctx->cache[i]);
            g_free(ctx->owner);
            ctx->owner = owner;
        } else
            g_free(owner);
    }
    unlock();
}
__attribute__((visibility("default"))) Ptr g_dbus_proxy_call_sync(Ptr proxy, const char *method,
                                                                  Ptr parameters, int flags,
                                                                  int timeout, Ptr cancel,
                                                                  Ptr error) {
    Call real = (Call)dlsym((Ptr)-1, "g_dbus_proxy_call_sync");
    if (!real)
        return 0;
    prepare(proxy);
    return real(proxy, method, parameters, flags, timeout, cancel, error);
}
static Bool replay(Ptr data) {
    struct Replay *r = data;
    // This runs in Sunshine's own portal wait context, after it starts its loop.
    // Calling synchronously from subscribe would quit a loop before it starts.
    r->callback(r->connection, r->value.sender, r->value.path, "org.freedesktop.portal.Request",
                "Response", r->value.body, r->data);
    static const char notice[] = "[lanto-portal] Recovered an early Portal response\n";
    write(2, notice, sizeof(notice) - 1);
    return 0;
}
static void destroy_replay(Ptr data) {
    struct Replay *r = data;
    clear(&r->value);
    g_object_unref(r->connection);
    g_free(r);
}
__attribute__((visibility("default"))) UInt g_dbus_connection_signal_subscribe(
    Ptr connection, const char *sender, const char *interface, const char *member, const char *path,
    const char *arg0, int flags, Signal callback, Ptr data, Notify destroy) {
    Subscribe real = (Subscribe)dlsym((Ptr)-1, "g_dbus_connection_signal_subscribe");
    if (!real)
        return 0;
    UInt id =
        real(connection, sender, interface, member, path, arg0, flags, callback, data, destroy);
    // Scope replay to Sunshine's stack-owned response waiter. Preserve ordinary
    // GIO subscriptions and all callers with a user-data destructor unchanged.
    if (!id || destroy || !path || !equal(sender, "org.freedesktop.portal.Desktop") ||
        !equal(interface, "org.freedesktop.portal.Request") || !equal(member, "Response"))
        return id;
    struct Replay *r = 0;
    lock();
    struct Context *ctx = g_object_get_data(connection, "lanto-portal-response");
    if (ctx)
        for (unsigned i = 0; i < 32; ++i)
            if (equal(path, ctx->cache[i].path)) {
                r = g_malloc0(sizeof(*r));
                r->value = ctx->cache[i];
                ctx->cache[i].body = 0;
                ctx->cache[i].path = 0;
                ctx->cache[i].sender = 0;
                break;
            }
    unlock();
    if (!r)
        return id;
    // In the subscribing thread, unsubscribe cancels any queued live callback.
    // This avoids delivering twice when the signal raced with real subscribe.
    g_dbus_connection_signal_unsubscribe(connection, id);
    r->connection = g_object_ref(connection);
    r->callback = callback;
    r->data = data;
    Ptr source = g_idle_source_new();
    g_source_set_priority(source, 0);
    g_source_set_callback(source, replay, r, destroy_replay);
    g_source_attach(source, g_main_context_get_thread_default());
    g_source_unref(source);
    // Sunshine accepts zero for its already-completed subscription and only
    // unsubscribes nonzero IDs. The one-shot source owns the pending delivery.
    return 0;
}

#ifdef LANTO_TEST
extern Ptr g_dbus_connection_new_for_address_sync(const char *, int, Ptr, Ptr, Ptr);
extern Ptr g_dbus_proxy_new_sync(Ptr, int, Ptr, const char *, const char *, const char *, Ptr, Ptr);
extern Ptr g_variant_parse(Ptr, const char *, const char *, Ptr, Ptr);
extern Ptr g_variant_get_child_value(Ptr, Size);
extern const char *g_variant_get_string(Ptr, Ptr);
extern UInt g_variant_get_uint32(Ptr);
extern Ptr g_main_context_new(void);
extern void g_main_context_push_thread_default(Ptr);
extern void g_main_context_pop_thread_default(Ptr);
extern void g_main_context_unref(Ptr);
extern Ptr g_main_loop_new(Ptr, Bool);
extern void g_main_loop_run(Ptr);
extern void g_main_loop_quit(Ptr);
extern void g_main_loop_unref(Ptr);
extern Ptr g_timeout_source_new(UInt);
extern void g_source_destroy(Ptr);
extern void g_usleep(unsigned long);
struct Test {
    Ptr loop;
    int received;
};
static void test_response(Ptr c, const char *s, const char *p, const char *i, const char *m,
                          Ptr args, Ptr data) {
    (void)c;
    (void)s;
    (void)p;
    (void)i;
    (void)m;
    struct Test *test = data;
    Ptr code = g_variant_get_child_value(args, 0);
    test->received = (int)g_variant_get_uint32(code);
    g_variant_unref(code);
    g_main_loop_quit(test->loop);
}
static Bool test_timeout(Ptr data) {
    g_main_loop_quit(data);
    return 0;
}
__attribute__((visibility("default"))) int lanto_portal_test(const char *address, int fix) {
    Ptr conn = g_dbus_connection_new_for_address_sync(address, 9, 0, 0, 0);
    if (!conn)
        return -1;
    Ptr proxy = g_dbus_proxy_new_sync(conn, 3, 0, "org.freedesktop.portal.Desktop",
                                      "/org/freedesktop/portal/desktop",
                                      "org.freedesktop.portal.RemoteDesktop", 0, 0);
    if (!proxy)
        return -2;
    Ptr context = g_main_context_new();
    g_main_context_push_thread_default(context);
    struct Test test = {g_main_loop_new(context, 0), -1};
    Ptr params = g_variant_parse(0,
                                 "(objectpath '/org/freedesktop/portal/desktop/session/test', '', "
                                 "{'handle_token': <'regression'>})",
                                 0, 0, 0);
    Call call = fix ? g_dbus_proxy_call_sync : (Call)dlsym((Ptr)-1, "g_dbus_proxy_call_sync");
    Ptr reply = call(proxy, "Start", params, 0, 2000, 0, 0);
    if (!reply)
        return -3;
    // Force the response to arrive before subscribing, as in the real failure.
    g_usleep(100000);
    Ptr child = g_variant_get_child_value(reply, 0);
    const char *path = g_variant_get_string(child, 0);
    Subscribe subscribe = fix ? g_dbus_connection_signal_subscribe
                              : (Subscribe)dlsym((Ptr)-1, "g_dbus_connection_signal_subscribe");
    UInt id = subscribe(conn, "org.freedesktop.portal.Desktop", "org.freedesktop.portal.Request",
                        "Response", path, 0, 0, test_response, &test, 0);
    Ptr timeout = g_timeout_source_new(300);
    g_source_set_callback(timeout, test_timeout, test.loop, 0);
    g_source_attach(timeout, context);
    g_main_loop_run(test.loop);
    if (id)
        g_dbus_connection_signal_unsubscribe(conn, id);
    g_source_destroy(timeout);
    g_source_unref(timeout);
    g_variant_unref(child);
    g_variant_unref(reply);
    g_variant_unref(params);
    g_main_loop_unref(test.loop);
    g_main_context_pop_thread_default(context);
    g_main_context_unref(context);
    g_object_unref(proxy);
    g_object_unref(conn);
    return test.received == 0 ? 0 : 1;
}
#endif
