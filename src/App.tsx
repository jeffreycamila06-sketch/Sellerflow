import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [email, setEmail] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);
  const login = async () => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          "https://vitejsvitetrr5rvnr-5173-4c73681d.local-credentialless.webcontainer.io",
      },
    });    
  
    if (error) {
      alert(error.message);
      console.log(error);
      return;
    }
  
    alert("Login email sent. Check inbox/spam/promotions.");
  };

const logout = async () => {
  await supabase.auth.signOut();
  setUser(null);
};

  if (!user) {
    return (
      <div style={styles.center}>
        <h1>🔐 SellerFlow Login</h1>

        <input
          style={styles.input}
          placeholder="Enter email"
          onChange={(e) => setEmail(e.target.value)}
        />

        <button style={styles.button} onClick={login}>
          Login
        </button>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <div style={styles.topbar}>
        <h2>📦 SellerFlow Dashboard</h2>

        <button onClick={logout} style={styles.logout}>
          Logout
        </button>
      </div>

      <div style={styles.grid}>
        <div style={styles.card}>
          <h3>📦 Products</h3>
          <p>Manage products here</p>
        </div>

        <div style={styles.card}>
          <h3>📊 Orders</h3>
          <p>Track seller orders</p>
        </div>

        <div style={styles.card}>
          <h3>👤 Profile</h3>
          <p>{user.email}</p>
          <p>🟢 Free Plan</p>
        </div>
      </div>
    </div>
  );
}

const styles: any = {
  app: {
    background: '#0f172a',
    minHeight: '100vh',
    color: 'white',
    padding: 20,
    fontFamily: 'Arial',
  },

  center: {
    background: '#0f172a',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    color: 'white',
  },

  input: {
    padding: 10,
    width: 250,
    marginTop: 10,
    borderRadius: 8,
    border: 'none',
  },

  button: {
    marginTop: 10,
    padding: 10,
    border: 'none',
    borderRadius: 8,
    background: '#38bdf8',
    cursor: 'pointer',
  },

  logout: {
    padding: 10,
    border: 'none',
    borderRadius: 8,
    background: '#ef4444',
    color: 'white',
    cursor: 'pointer',
  },

  topbar: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 20,
  },

  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 15,
  },

  card: {
    background: '#1e293b',
    padding: 20,
    borderRadius: 12,
    minHeight: 200,
  },
};
