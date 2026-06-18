package org.json;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Minimal org.json.JSONObject stub — ONLY the methods TsplBuilder.java uses,
 * plus put()/toString() so the golden generator can build payloads and emit
 * the canonical JSON the Swift + web parity tests consume. NOT a general JSON
 * library; it exists solely to compile the unmodified production TsplBuilder
 * and produce byte-exact Android golden fixtures without an external jar.
 */
public class JSONObject {
    private final LinkedHashMap<String, Object> map = new LinkedHashMap<>();

    public JSONObject() {}

    public JSONObject put(String key, Object value) {
        map.put(key, value);
        return this;
    }

    public JSONObject optJSONObject(String key) {
        Object v = map.get(key);
        return v instanceof JSONObject ? (JSONObject) v : null;
    }

    public JSONArray optJSONArray(String key) {
        Object v = map.get(key);
        return v instanceof JSONArray ? (JSONArray) v : null;
    }

    public String optString(String key, String def) {
        Object v = map.get(key);
        return v == null ? def : String.valueOf(v);
    }

    public String optString(String key) {
        return optString(key, "");
    }

    public int optInt(String key, int def) {
        Object v = map.get(key);
        return v instanceof Number ? ((Number) v).intValue() : def;
    }

    public double optDouble(String key, double def) {
        Object v = map.get(key);
        return v instanceof Number ? ((Number) v).doubleValue() : def;
    }

    public boolean optBoolean(String key, boolean def) {
        Object v = map.get(key);
        return v instanceof Boolean ? (Boolean) v : def;
    }

    @Override
    public String toString() {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Object> e : map.entrySet()) {
            if (!first) sb.append(",");
            first = false;
            sb.append(Json.quote(e.getKey())).append(":").append(Json.val(e.getValue()));
        }
        return sb.append("}").toString();
    }
}
