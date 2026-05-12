import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export default function App() {
  const [email, setEmail] = useState("");
  const [user, setUser] = useState<any>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [language, setLanguage] = useState("English");

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async () => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });

    if (error) return alert(error.message);
    alert("Magic link sent. Check your email.");
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  if (!user) {
    return (
      <div style={styles.loginPage}>
        <h1>🔐 SellerFlow Login</h1>
        <input
          type="email"
          value={email}
          placeholder="Enter email"
          style={styles.input}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button style={styles.blueBtn} onClick={login}>
          Login
        </button>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <aside style={styles.sidebar}>
        <h2 style={styles.logo}>🚀 SellerFlow</h2>

        <div style={styles.navItem}>▦ Report</div>
        <div style={styles.navActive}>↗ Sales</div>
        <div style={styles.navItem}>📄 Orders</div>
        <div style={styles.navItem}>👥 Customers</div>

        <div style={styles.navGroup}>
          <div style={styles.navItem}>⚙️ Settings</div>
          <div style={styles.subItem}>🖨️ Printer Setup</div>
        </div>

        <button style={styles.logoutBtn} onClick={logout}>
          Logout
        </button>
      </aside>

      <main style={styles.main}>
        <div style={styles.topBar}>
          <div style={styles.shopBadge}>🛍️ Seller flow</div>

          <div style={styles.topRight}>
            <select
              style={styles.languageBox}
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option>English</option>
              <option>Filipino</option>
              <option>Chinese</option>
              <option>veitnam</option>
            </select>

            <button
              style={styles.profileCircle}
              onClick={() => setShowProfile(!showProfile)}
            >
              {user.email?.[0]?.toUpperCase() || "U"}
            </button>

            {showProfile && (
              <div style={styles.profilePopup}>
                <h3>Profile</h3>
                <p>{user.email}</p>
                <p>
                  <b>Plan:</b> Free Trial
                </p>
                <p>
                  <b>Subscription Expiry:</b> June 12, 2026
                </p>
                <button style={styles.upgradeBtn}>Upgrade Plan</button>
              </div>
            )}
          </div>
        </div>

        <div style={styles.searchRow}>
          <input
            style={styles.search}
            placeholder="Search TikTok account or FB page"
          />
          <button style={styles.filterBtn}>🔎</button>
          <button style={styles.filterBtn}>🔽</button>
        </div>

        <div style={styles.contentGrid}>
          <section>
            <div style={styles.postCard}>
              <div style={styles.postHeader}>
                <div>
                  <b>Budget Ukay</b>
                  <p style={styles.smallText}>🕒 10/12/2024 21:39:19</p>
                </div>
                <span>•••</span>
              </div>

              <p>
                Thank you so much grabe kayo na mismo naghahanap samen maraming
                maraming salamat.
              </p>

              <div style={styles.imageBox}>
                <h2>Wala kana live now sis?</h2>
                <h2>Thank you so much ❤️</h2>
              </div>

              <div style={styles.postStats}>
                <span>👍 0</span>
                <span>💬 0</span>
                <span>↗ 0</span>
                <span>📋 0</span>
                <b>Details ❯</b>
              </div>
            </div>
          </section>

          <aside style={styles.presetBox}>
            <h2>Livestream Presets</h2>

            <div style={styles.presetCard}>
              <div style={styles.mascot}>🤖</div>
              <p>
                Be prepared for a better livestream. Set up products and make
                time notifications to customers.
              </p>

              <div style={styles.presetButtons}>
                <button style={styles.orangeBtn}>⚙️ General settings</button>
                <button style={styles.cyanBtn}>📋 Auto create order</button>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

const styles: any = {
  loginPage: {
    height: "100vh",
    background: "#0f172a",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    gap: 15,
  },

  app: {
    width: "100vw",
    height:"100vh",
    overflow: "hidden",
    display: "flex",
    background: "linear-gradient(to right, #1f2937, #d1d5db)",
    fontFamily: "Arial",
    color: "#111827",
  },

  sidebar: {
    width: 240,
    background: "white",
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    borderRight: "1px solid #ddd",
  },

  logo: {
    marginBottom: 20,
  },

  navItem: {
    padding: 14,
    borderRadius: 12,
    fontSize: 18,
    cursor: "pointer",
  },

  navActive: {
    padding: 14,
    borderRadius: 12,
    fontSize: 18,
    cursor: "pointer",
    background: "#dbe8ff",
    color: "#2563eb",
    fontWeight: "bold",
  },

  navGroup: {
    marginTop: 10,
  },

  subItem: {
    marginLeft: 25,
    padding: 10,
    color: "#475569",
  },

  logoutBtn: {
    marginTop: "auto",
    padding: 14,
    border: "none",
    borderRadius: 10,
    background: "#ef4444",
    color: "white",
    cursor: "pointer",
  },

  main: {
    flex: 1,
    hieght: "100vh",
    overflowY: "auto",
    padding: 28,
    position: "relative",
  },

  topBar: {
    background: "white",
    borderRadius: 8,
    padding: 16,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 25,
    border: "1px solid #d1d5db",
  },

  shopBadge: {
    fontWeight: "bold",
    fontSize: 18,
  },

  topRight: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 12,
  },

  languageBox: {
    padding: "10px 12px",
    borderRadius: 999,
    border: "1px solid #d1d5db",
    background: "white",
    cursor: "pointer",
  },

  profileCircle: {
    width: 42,
    height: 42,
    borderRadius: "50%",
    border: "none",
    background: "#2563eb",
    color: "white",
    fontWeight: "bold",
    fontSize: 18,
    cursor: "pointer",
  },

  profilePopup: {
    position: "absolute",
    top: 55,
    right: 0,
    width: 280,
    background: "white",
    border: "1px solid #d1d5db",
    borderRadius: 12,
    padding: 16,
    boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
    zIndex: 10,
  },

  upgradeBtn: {
    width: "100%",
    padding: 10,
    borderRadius: 8,
    border: "none",
    background: "#22c55e",
    color: "white",
    cursor: "pointer",
    fontWeight: "bold",
  },

  searchRow: {
    display: "flex",
    gap: 12,
    marginBottom: 25,
  },

  search: {
    flex: 1,
    padding: 16,
    borderRadius: 8,
    border: "1px solid #d1d5db",
    fontSize: 18,
  },

  filterBtn: {
    padding: "0 18px",
    border: "none",
    borderRadius: 8,
    background: "white",
    fontSize: 20,
    cursor: "pointer",
  },

  contentGrid: {
    display: "grid",
    gridTemplateColumns: "2fr 1fr",
    gap: 25,
  },

  postCard: {
    background: "white",
    borderRadius: 8,
    padding: 24,
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  },

  postHeader: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 20,
  },

  smallText: {
    margin: 0,
    color: "#64748b",
    fontSize: 13,
  },

  imageBox: {
    marginTop: 20,
    background: "#f8fafc",
    height: 260,
    borderRadius: 8,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    paddingLeft: 40,
    color: "#111827",
    border: "1px solid #eee",
  },

  postStats: {
    marginTop: 18,
    display: "flex",
    justifyContent: "space-between",
    fontSize: 18,
  },

  presetBox: {
    background: "white",
    borderRadius: 8,
    padding: 18,
    height: "fit-content",
    border: "1px solid #d1d5db",
  },

  presetCard: {
    marginTop: 20,
    background: "#fff",
    border: "1px solid #e5e7eb",
    padding: 20,
    borderRadius: 8,
    fontSize: 18,
  },

  mascot: {
    fontSize: 55,
  },

  presetButtons: {
    display: "flex",
    gap: 12,
    marginTop: 20,
  },

  orangeBtn: {
    flex: 1,
    padding: 14,
    border: "none",
    borderRadius: 8,
    background: "#f97316",
    color: "white",
    fontWeight: "bold",
    cursor: "pointer",
  },

  cyanBtn: {
    flex: 1,
    padding: 14,
    border: "none",
    borderRadius: 8,
    background: "#22c7d9",
    color: "white",
    fontWeight: "bold",
    cursor: "pointer",
  },

  input: {
    padding: 12,
    width: 280,
    borderRadius: 8,
    border: "none",
    outline: "none",
  },

  blueBtn: {
    padding: "12px 20px",
    borderRadius: 8,
    border: "none",
    background: "#00A8FF",
    color: "white",
    cursor: "pointer",
  },
};