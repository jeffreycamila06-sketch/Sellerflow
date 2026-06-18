package org.json;

/** Shared JSON serialization helpers for the stub. Emits ASCII-safe JSON
 *  (\\uXXXX for any char outside 0x20–0x7E) so the committed payload fixtures
 *  are byte-stable regardless of file encoding. */
final class Json {
    private Json() {}

    static String val(Object v) {
        if (v == null) return "null";
        if (v instanceof JSONObject || v instanceof JSONArray) return v.toString();
        if (v instanceof Number || v instanceof Boolean) return String.valueOf(v);
        return quote(String.valueOf(v));
    }

    static String quote(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20 || c > 0x7E) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.append("\"").toString();
    }
}
