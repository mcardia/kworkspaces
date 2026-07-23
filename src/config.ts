// Configuration: read fresh from the script's kwinrc section via readConfig()
// on every check, matching the original script (which never caches this, since
// it can change live via System Settings while the script keeps running).

interface KWorkspacesConfig {
    keepEmptyMiddleDesktops: boolean;
    maxDesktops: number;
}

function readBool(key: string, fallback: boolean): boolean {
    const raw = readConfig(key, fallback);
    if (typeof raw === "boolean") {
        return raw;
    }
    const text = String(raw).toLowerCase();
    return text === "true" || text === "1";
}

function readInt(key: string, fallback: number): number {
    const raw = readConfig(key, fallback);
    const value = typeof raw === "number" ? raw : parseInt(String(raw), 10);
    return isNaN(value) ? fallback : value;
}

function loadConfig(): KWorkspacesConfig {
    return {
        keepEmptyMiddleDesktops: readBool("keepEmptyMiddleDesktops", false),
        maxDesktops: Math.max(2, readInt("maxDesktops", 20)),
    };
}
