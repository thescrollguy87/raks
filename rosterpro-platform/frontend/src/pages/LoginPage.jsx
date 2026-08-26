import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../store/AuthContext.jsx";
import { ApiError } from "../api/client.js";

// Markup and class names match the prototype's #login-screen exactly
// (login-screen, login-box, lm/ln/ls, l-avatar, l-title, l-form, l-label,
// l-input, l-err, l-btn, l-view) — every visual detail comes from
// styles/rosterpro.css unchanged, only the behaviour is now real.
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/";

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password, mfaRequired ? mfaCode : undefined);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.details?.mfaRequired) {
        setMfaRequired(true);
        setError("Enter your 6-digit authenticator code");
      } else {
        setError(err.message || "Invalid credentials");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-box">
        <span className="lm">AMD · M&amp;E</span>
        <span className="ln">RosterPro</span>
        <span className="ls">Ahmedabad Line Maintenance · DGCA Compliant</span>
        <div className="l-avatar">RP</div>
        <div className="l-title">Sign In</div>
        <div className="l-sub">Station I/C login for full access · Staff for view only</div>

        <form className="l-form" onSubmit={handleSubmit}>
          <div>
            <label className="l-label">Email</label>
            <input
              className="l-input" type="email" placeholder="rakesh.patel@amd.example"
              value={email} onChange={(e) => setEmail(e.target.value)} required
            />
          </div>
          <div>
            <label className="l-label">Password</label>
            <input
              className="l-input" type="password" placeholder="Password"
              value={password} onChange={(e) => setPassword(e.target.value)} required
            />
          </div>
          {mfaRequired && (
            <div>
              <label className="l-label">Authenticator Code</label>
              <input
                className="l-input" type="text" inputMode="numeric" maxLength={6}
                placeholder="123456" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} required
              />
            </div>
          )}
          {error && <div className="l-err" style={{ display: "block" }}>{error}</div>}
          <button className="l-btn" type="submit" disabled={loading}>
            {loading ? "Signing in…" : "🔐 Sign In"}
          </button>
        </form>

        <div className="l-view">
          <a href="/forgot-password">Forgot password?</a>
        </div>
      </div>
    </div>
  );
}
