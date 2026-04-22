import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import {
  Eye, EyeOff, Mail, Lock, User, AtSign,
  Pill, AlertCircle, CheckCircle,
  ArrowRight, Loader2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// ── Password strength helper ──────────────────────────────────────────────────

function getStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: 'Weak', color: '#ef4444' };
  if (score <= 2) return { score, label: 'Fair', color: '#f97316' };
  if (score <= 3) return { score, label: 'Good', color: '#eab308' };
  return { score, label: 'Strong', color: '#22c55e' };
}

// ── Input component ───────────────────────────────────────────────────────────

interface InputFieldProps {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  icon: React.ReactNode;
  error?: string;
  autoComplete?: string;
  suffix?: React.ReactNode;
}

function InputField({ label, type = 'text', value, onChange, placeholder, icon, error, autoComplete, suffix }: InputFieldProps) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{icon}</span>
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={`w-full pl-10 ${suffix ? 'pr-10' : 'pr-4'} py-2.5 border rounded-lg text-sm outline-none transition-all
            ${error
              ? 'border-red-400 bg-red-50 focus:ring-2 focus:ring-red-200'
              : 'border-gray-300 bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
            }`}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">{suffix}</span>
        )}
      </div>
      {error && (
        <p className="text-red-500 text-xs flex items-center gap-1">
          <AlertCircle size={11} /> {error}
        </p>
      )}
    </div>
  );
}

// ── Login form ────────────────────────────────────────────────────────────────

function LoginForm({ onSwitch, from }: { onSwitch: () => void; from: string }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!identifier.trim() || !password) {
      setError('Please fill in all fields');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      let data: Record<string, unknown>;
      try { data = await res.json(); } catch { data = {}; }
      if (!res.ok) throw new Error((data.detail as string) || 'Login failed');
      login(data.access_token as string, data.user as import('../context/AuthContext').AuthUser);
      navigate(from, { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <InputField
        label="Username or Email"
        value={identifier}
        onChange={setIdentifier}
        placeholder="username or email@example.com"
        icon={<AtSign size={16} />}
        autoComplete="username"
      />
      <InputField
        label="Password"
        type={showPw ? 'text' : 'password'}
        value={password}
        onChange={setPassword}
        placeholder="Enter password"
        icon={<Lock size={16} />}
        autoComplete="current-password"
        suffix={
          <button type="button" onClick={() => setShowPw(p => !p)} className="text-gray-400 hover:text-gray-600 transition-colors">
            {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        }
      />

      {/* Forgot password */}
      <div className="flex justify-end">
        <button
          type="button"
          className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
          onClick={() => alert('Password reset via email will be available soon.')}
        >
          Forgot password?
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-red-700 text-sm">
          <AlertCircle size={15} className="shrink-0" />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-[#133670] hover:bg-[#0b1f47] text-white py-3 rounded-lg font-semibold text-sm transition-all shadow-md hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
        {loading ? 'Signing in...' : 'Sign In'}
      </button>

      <p className="text-center text-sm text-gray-500">
        Don't have an account?{' '}
        <button type="button" onClick={onSwitch} className="text-blue-600 font-semibold hover:underline">
          Sign up now
        </button>
      </p>
    </form>
  );
}

// ── Register form ─────────────────────────────────────────────────────────────

function RegisterForm({ onSwitch, from }: { onSwitch: () => void; from: string }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showCp, setShowCp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const strength = getStrength(password);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!fullName.trim()) errs.fullName = 'Please enter your full name';
    if (!email.trim() || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) errs.email = 'Invalid email';
    if (!username.trim() || username.length < 3) errs.username = 'At least 3 characters';
    if (password.length < 8) errs.password = 'Password must be at least 8 characters';
    if (password !== confirmPassword) errs.confirmPassword = 'Passwords do not match';
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError('');
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          full_name: fullName.trim(),
          password,
          confirm_password: confirmPassword,
        }),
      });
      let data: Record<string, unknown>;
      try { data = await res.json(); } catch { data = {}; }
      if (!res.ok) {
        if (data.detail && Array.isArray(data.detail)) {
          const msg = (data.detail as { msg: string }[]).map((d) => d.msg).join(', ');
          throw new Error(msg);
        }
        throw new Error((data.detail as string) || 'Registration failed. Please try again.');
      }
      login(data.access_token as string, data.user as import('../context/AuthContext').AuthUser);
      navigate(from, { replace: true });
    } catch (err: unknown) {
      setApiError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <InputField
        label="Full name"
        value={fullName}
        onChange={setFullName}
        placeholder="John Doe"
        icon={<User size={16} />}
        error={fieldErrors.fullName}
        autoComplete="name"
      />
      <InputField
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="email@example.com"
        icon={<Mail size={16} />}
        error={fieldErrors.email}
        autoComplete="email"
      />
      <InputField
        label="Username"
        value={username}
        onChange={setUsername}
        placeholder="username"
        icon={<AtSign size={16} />}
        error={fieldErrors.username}
        autoComplete="username"
      />

      {/* Password with strength */}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">Password</label>
        <div className="relative">
          <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            className={`w-full pl-10 pr-10 py-2.5 border rounded-lg text-sm outline-none transition-all
              ${fieldErrors.password ? 'border-red-400 bg-red-50 focus:ring-2 focus:ring-red-200' : 'border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100'}`}
          />
          <button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {password && (
          <div className="space-y-1">
            <div className="flex gap-1 h-1">
              {[1, 2, 3, 4, 5].map(i => (
                <div
                  key={i}
                  className="flex-1 rounded-full transition-all duration-300"
                  style={{ backgroundColor: i <= strength.score ? strength.color : '#e5e7eb' }}
                />
              ))}
            </div>
            <p className="text-xs" style={{ color: strength.color }}>{strength.label}</p>
          </div>
        )}
        {fieldErrors.password && <p className="text-red-500 text-xs flex items-center gap-1"><AlertCircle size={11} />{fieldErrors.password}</p>}
      </div>

      <InputField
        label="Confirm password"
        type={showCp ? 'text' : 'password'}
        value={confirmPassword}
        onChange={setConfirmPassword}
        placeholder="Re-enter password"
        icon={<Lock size={16} />}
        error={fieldErrors.confirmPassword}
        autoComplete="new-password"
        suffix={
          <button type="button" onClick={() => setShowCp(p => !p)} className="text-gray-400 hover:text-gray-600 transition-colors">
            {showCp ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        }
      />
      {/* Match indicator */}
      {confirmPassword && !fieldErrors.confirmPassword && (
        <p className="text-green-600 text-xs flex items-center gap-1">
          <CheckCircle size={11} /> Passwords match
        </p>
      )}

      {apiError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-red-700 text-sm">
          <AlertCircle size={15} className="shrink-0" />
          {apiError}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-[#133670] hover:bg-[#0b1f47] text-white py-3 rounded-lg font-semibold text-sm transition-all shadow-md hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
        {loading ? 'Creating account...' : 'Create Account'}
      </button>

      <p className="text-center text-sm text-gray-500">
        Already have an account?{' '}
        <button type="button" onClick={onSwitch} className="text-blue-600 font-semibold hover:underline">
          Sign in
        </button>
      </p>
    </form>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AuthPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const initialMode: 'login' | 'register' =
    location.pathname === '/register' || searchParams.get('mode') === 'register'
      ? 'register'
      : 'login';
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);

  const { user } = useAuth();
  const navigate = useNavigate();

  // Destination after login: came from a redirect? Go there. Otherwise go back or home.
  const from: string = (location.state as { from?: string })?.from ?? '/';

  // Already logged in — redirect
  useEffect(() => {
    if (user) navigate(from, { replace: true });
  }, [user, navigate, from]);

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{
        background: 'linear-gradient(135deg, #0b1f47 0%, #133670 45%, #1a4a9e 100%)',
      }}
    >
      {/* Decorative blobs */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-white/5" />
        <div className="absolute -bottom-24 -right-24 w-80 h-80 rounded-full bg-white/5" />
        <div className="absolute top-1/2 left-1/4 w-64 h-64 rounded-full bg-blue-400/10" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <Link to="/" className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center shadow-lg">
            <Pill size={24} className="text-[#133670]" />
          </div>
          <div className="leading-tight">
            <span className="text-white font-bold text-2xl tracking-tight">MediDB</span>
            <span className="block text-blue-300 text-xs font-medium -mt-0.5">Clinical Decision Support</span>
          </div>
        </Link>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {/* Mode tabs */}
          <div className="flex bg-gray-100 rounded-xl p-1 mb-6">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                mode === 'login'
                  ? 'bg-white text-[#133670] shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => setMode('register')}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                mode === 'register'
                  ? 'bg-white text-[#133670] shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* Heading */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">
              {mode === 'login' ? 'Welcome back' : 'Create a new account'}
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {mode === 'login'
                ? 'Sign in to save history and personalize your experience'
                : 'Free · No credit card required'}
            </p>
          </div>

          {mode === 'login'
            ? <LoginForm onSwitch={() => setMode('register')} from={from} />
            : <RegisterForm onSwitch={() => setMode('login')} from={from} />
          }
        </div>

        {/* Back link */}
        <p className="text-center text-sm text-blue-300 mt-6">
          <Link to="/" className="hover:text-white transition-colors">← Back to home</Link>
        </p>
      </div>
    </div>
  );
}
