package org.json;

import java.util.ArrayList;

/** Minimal org.json.JSONArray stub — see JSONObject for rationale. */
public class JSONArray {
    private final ArrayList<Object> list = new ArrayList<>();

    public JSONArray put(Object value) {
        list.add(value);
        return this;
    }

    public int length() {
        return list.size();
    }

    public JSONObject optJSONObject(int i) {
        Object v = (i >= 0 && i < list.size()) ? list.get(i) : null;
        return v instanceof JSONObject ? (JSONObject) v : null;
    }

    @Override
    public String toString() {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < list.size(); i++) {
            if (i > 0) sb.append(",");
            sb.append(Json.val(list.get(i)));
        }
        return sb.append("]").toString();
    }
}
