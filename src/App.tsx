import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export default function App() {
  const [email, setEmail] = useState("");
  const [user, setUser] = useState<any>(null);
  const [page, setPage] = useState("sales");

  const [orders, setOrders] = useState<any[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [product, setProduct] = useState("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      setUser(session?.user || null);
    });

    supabase.auth.getUser().then(({ data }: any ) => {
      setUser(data.user);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) fetchOrders();
  }, [user]);

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

  const fetchOrders = async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return alert(error.message);
    setOrders(data || []);
  };

  const addOrder = async () => {
    if (!customerName || !product) {
      alert("Please enter customer and product.");
      return;
    }

    const { error } = await supabase.from("orders").insert({
      user_id: user.id,
      customer_name: customerName,
      product,
      status: "Pending",
      total_amount: Number(amount || 0),
    });

    if (error) return alert(error.message);

    setCustomerName("");
    setProduct("");
    setAmount("");
    fetchOrders();
  };

  const autoCreateOrder = async () => {
    const comment = prompt("Paste live comment. Example: mine tshirt red 2pcs");
    if (!comment) return;

    const { error } = await supabase.from("orders").insert({
      user_id: user.id,
      customer_name: "Live Customer",
      product: comment,
      status: "Pending",
      total_amount: 0,
    });

    if (error) return alert(error.message);

    fetchOrders();
    setPage("orders");
  };

  const deleteOrder = async (id: number) => {
    const { error } = await supabase.from("orders").delete().eq("id", id);
    if (error) return alert(error.message);
    fetchOrders();
  };

  const totalSales = orders.reduce(
    (sum, order) => sum + Number(order.total_amount || 0),
    0
  );

  const uniqueCustomers = [...new Set(orders.map((o) => o.customer_name))];

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

  const renderPage = () => {
    if (page === "sales") {
      return (
        <>
          <h1 style={styles.title}>📊 Sales Report</h1>

          <div style={styles.statsRow}>
            <div style={styles.statCard}>
              <h2>{orders.length}</h2>
              <p>Total Orders</p>
            </div>

            <div style={styles.statCard}>
              <h2>{uniqueCustomers.length}</h2>
              <p>Customers</p>
            </div>

            <div style={styles.statCard}>
              <h2>{totalSales}</h2>
              <p>Total Sales</p>
            </div>
          </div>

          <div style={styles.contentRow}>
            <div style={styles.postCard}>
              <h2>Recent Activity</h2>
              {orders.slice(0, 5).map((order) => (
                <div key={order.id} style={styles.activityItem}>
                  <b>{order.customer_name}</b> ordered {order.product}
                </div>
              ))}
              {orders.length === 0 && <p>No activity yet.</p>}
            </div>

            <div style={styles.liveBox}>
              <h2>Livestream Presets</h2>
              <p>Prepare products and create orders faster during live selling.</p>

              <button style={styles.orangeBtn}>⚙ General settings</button>
              <button style={styles.blueBtn} onClick={autoCreateOrder}>
                📄 Auto create order
              </button>
            </div>
          </div>
        </>
      );
    }

    if (page === "orders") {
      return (
        <>
          <h1 style={styles.title}>📦 Orders</h1>

          <div style={styles.formBox}>
            <input
              style={styles.formInput}
              placeholder="Customer name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />

            <input
              style={styles.formInput}
              placeholder="Product"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
            />

            <input
              style={styles.formInput}
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />

            <button style={styles.orangeBtn} onClick={addOrder}>
              Add Order
            </button>
          </div>

          <div style={styles.card}>
            <h2>Orders</h2>

            <table style={styles.table}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Product</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>{order.customer_name}</td>
                    <td>{order.product}</td>
                    <td>{order.status}</td>
                    <td>{order.total_amount}</td>
                    <td>
                      <button
                        style={styles.deleteBtn}
                        onClick={() => deleteOrder(order.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {orders.length === 0 && <p>No orders yet.</p>}
          </div>
        </>
      );
    }

    if (page === "customers") {
      return (
        <>
          <h1 style={styles.title}>👥 Customers</h1>

          <div style={styles.card}>
            {uniqueCustomers.map((customer) => (
              <div key={customer} style={styles.customerItem}>
                👤 {customer}
              </div>
            ))}

            {uniqueCustomers.length === 0 && <p>No customers yet.</p>}
          </div>
        </>
      );
    }

    if (page === "livestream") {
      return (
        <>
          <h1 style={styles.title}>🎥 Livestream Presets</h1>

          <div style={styles.card}>
            <h2>Default Live Selling Preset</h2>
            <p>Use this to prepare products before going live.</p>

            <button style={styles.orangeBtn}>⚙ General settings</button>
            <button style={styles.blueBtn} onClick={autoCreateOrder}>
              📄 Auto create order
            </button>
          </div>
        </>
      );
    }

    if (page === "printer") {
      return (
        <>
          <h1 style={styles.title}>🖨 Printer Setup</h1>

          <div style={styles.card}>
            <p>Printer Status: Not connected</p>
            <button style={styles.blueBtn}>Test Print</button>
          </div>
        </>
      );
    }

    if (page === "subscription") {
      return (
        <>
          <h1 style={styles.title}>💳 Subscription</h1>

          <div style={styles.card}>
            <h2>Free Plan</h2>
            <p>Subscription Expiry: June 12, 2026</p>
            <button style={styles.orangeBtn}>Upgrade $10/month</button>
          </div>
        </>
      );
    }

    return null;
  };

  return (
    <div style={styles.app}>
      <div style={styles.sidebar}>
        <h1 style={styles.logo}>🚀 SellerFlow</h1>

        <button style={styles.menuBtn} onClick={() => setPage("sales")}>
          📊 Sales Report
        </button>

        <button style={styles.menuBtn} onClick={() => setPage("orders")}>
          📦 Orders
        </button>

        <button style={styles.menuBtn} onClick={() => setPage("customers")}>
          👥 Customers
        </button>

        <button style={styles.menuBtn} onClick={() => setPage("livestream")}>
          🎥 Livestream
        </button>

        <button style={styles.menuBtn} onClick={() => setPage("printer")}>
          🖨 Printer Setup
        </button>

        <button style={styles.menuBtn} onClick={() => setPage("subscription")}>
          💳 Subscription
        </button>

        <button style={styles.logoutBtn} onClick={logout}>
          Logout
        </button>
      </div>

      <div style={styles.main}>
        <div style={styles.topBar}>
          <input
            style={styles.search}
            placeholder="Search TikTok account or FB page"
          />

          <select style={styles.language}>
            <option>English</option>
            <option>Filipino</option>
            <option>Chinese</option>
          </select>

          <div style={styles.profileCircle}>JC</div>
        </div>

        <div style={styles.pageContainer}>{renderPage()}</div>
      </div>
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
    height: "100vh",
    display: "flex",
    overflow: "hidden",
    fontFamily: "Arial",
    background: "linear-gradient(to right, #2f3542, #d1d5db)",
  },

  sidebar: {
    width: 190,
    background: "white",
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },

  logo: {
    fontSize: 22,
    marginBottom: 20,
  },

  menuBtn: {
    padding: 13,
    border: "none",
    borderRadius: 10,
    background: "#f1f2f6",
    cursor: "pointer",
    fontSize: 14,
    textAlign: "left",
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
    display: "flex",
    flexDirection: "column",
  },

  topBar: {
    height: 70,
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 15,
    padding: "0 25px",
  },

  search: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    border: "none",
    fontSize: 15,
  },

  language: {
    padding: 10,
    borderRadius: 8,
    border: "none",
  },

  profileCircle: {
    width: 45,
    height: 45,
    borderRadius: "50%",
    background: "#111827",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "bold",
  },

  pageContainer: {
    flex: 1,
    padding: 25,
    overflowY: "auto",
  },

  title: {
    color: "white",
  },

  statsRow: {
    display: "flex",
    gap: 20,
    marginBottom: 25,
  },

  statCard: {
    background: "white",
    padding: 20,
    borderRadius: 12,
    minWidth: 180,
  },

  contentRow: {
    display: "flex",
    gap: 20,
  },

  postCard: {
    flex: 1,
    background: "white",
    borderRadius: 15,
    padding: 20,
  },

  liveBox: {
    width: 300,
    background: "white",
    borderRadius: 15,
    padding: 20,
    height: "fit-content",
  },

  card: {
    background: "white",
    padding: 20,
    borderRadius: 12,
    marginBottom: 15,
  },

  formBox: {
    display: "flex",
    gap: 10,
    background: "white",
    padding: 15,
    borderRadius: 12,
    marginBottom: 20,
  },

  formInput: {
    padding: 12,
    borderRadius: 8,
    border: "1px solid #ddd",
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
  },

  orangeBtn: {
    padding: 12,
    border: "none",
    borderRadius: 8,
    background: "#ff9f43",
    color: "white",
    cursor: "pointer",
    fontWeight: "bold",
    marginTop: 10,
  },

  blueBtn: {
    padding: 12,
    border: "none",
    borderRadius: 8,
    background: "#3742fa",
    color: "white",
    cursor: "pointer",
    fontWeight: "bold",
    marginTop: 10,
  },

  deleteBtn: {
    padding: 8,
    border: "none",
    borderRadius: 6,
    background: "#ef4444",
    color: "white",
    cursor: "pointer",
  },

  customerItem: {
    padding: 12,
    background: "#f1f2f6",
    borderRadius: 8,
    marginBottom: 10,
  },

  activityItem: {
    padding: 12,
    borderBottom: "1px solid #e5e7eb",
  },

  input: {
    padding: 12,
    width: 280,
    borderRadius: 8,
    border: "none",
    outline: "none",
  },
};