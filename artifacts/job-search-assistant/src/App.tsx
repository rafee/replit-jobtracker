import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Bookmark, BriefcaseBusiness,
  Check, CheckCircle2, ChevronDown, CircleHelp, Clock3, FileText, Globe2,
  LayoutDashboard, Link2, LoaderCircle, LogOut, MapPin, Menu,
  Plus, RefreshCw, Search, Settings2, Sparkles, Target, Trash2, UserRound,
  X, ExternalLink, CircleAlert, Save, Pencil, Download,
} from 'lucide-react';
import { Link, Redirect, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import {
  getGetDashboardQueryKey, getGetProfileQueryKey, getListJobsQueryKey,
  getListResumeDraftsQueryKey, useCreateResumeDraft, useDeleteJob,
  useGetDashboard, useGetProfile, useListJobs, useListResumeDrafts,
  useSaveJob, useSaveProfile, useSearchJobs, useUpdateJob,
  useUpdateResumeDraft, useDownloadResumeDraft,
  getDownloadResumeDraftQueryKey,
} from '@workspace/api-client-react';
import type {
  CandidateProfile, CandidateProfileInput, JobSearchInput, JobSearchResult,
  ResumeDraft, TrackedJob, TrackedJobStatus,
} from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';
import { ErrorBoundary } from '@/components/error-boundary';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

const appearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: {
    colorPrimary: '#28584d', colorForeground: '#203b35', colorMutedForeground: '#687b73',
    colorDanger: '#bc5044', colorBackground: '#fbfaf5', colorInput: '#f8f6ee',
    colorInputForeground: '#203b35', colorNeutral: '#ded9cc', fontFamily: 'DM Sans, sans-serif', borderRadius: '0.7rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fbfaf5] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#203b35] font-bold', headerSubtitle: 'text-[#687b73]',
    socialButtonsBlockButtonText: 'text-[#203b35] font-semibold', formFieldLabel: 'text-[#314e45] font-semibold',
    footerActionLink: 'text-[#28584d] font-semibold', footerActionText: 'text-[#687b73]',
    dividerText: 'text-[#687b73]', identityPreviewEditButton: 'text-[#28584d]',
    formFieldSuccessText: 'text-[#28584d]', alertText: 'text-[#a64239]',
    logoBox: 'mb-3', logoImage: 'h-9', socialButtonsBlockButton: 'border-[#ded9cc] bg-[#fbfaf5]',
    formButtonPrimary: 'bg-[#28584d] hover:bg-[#1d473d] text-white',
    formFieldInput: 'border-[#ded9cc] bg-[#f8f6ee] text-[#203b35]',
    footerAction: 'pt-2', dividerLine: 'bg-[#ded9cc]', alert: 'bg-[#f8ebe7]',
    otpCodeFieldInput: 'border-[#ded9cc] bg-[#f8f6ee]', formFieldRow: 'mb-4', main: 'text-[#203b35]',
  },
};

function BrandMark({ inverse = false }: { inverse?: boolean }) {
  return <span className={`brand-mark ${inverse ? 'brand-mark-inverse' : ''}`} aria-label="Nextstep">
    <span className="mark-glyph"><span /><span /><span /></span><span>nextstep</span>
  </span>;
}

function AppButton({ children, onClick, variant = 'primary', disabled, type = 'button', testId, className = '' }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; disabled?: boolean; type?: 'button' | 'submit'; testId?: string; className?: string;
}) {
  return <button type={type} onClick={onClick} disabled={disabled} data-testid={testId} className={`btn btn-${variant} ${className}`}>{children}</button>;
}

function Landing() {
  return <main className="landing app-grain">
    <header className="landing-nav"><Link href="/" className="brand-link"><BrandMark /></Link><div className="landing-actions">
      <Link href="/sign-in" className="text-link">Sign in</Link><Link href="/sign-up" className="btn btn-primary">Make your workspace <ArrowRight size={15} /></Link>
    </div></header>
    <section className="hero">
      <div className="hero-copy rise-in">
        <div className="eyebrow"><span className="eyebrow-dot" /> YOUR NEXT CHAPTER, ORGANIZED</div>
        <h1>A steadier way<br />to find <em>what’s next.</em></h1>
        <p className="hero-sub">Keep the right opportunities, your real story, and one clear next step in the same place.</p>
        <div className="hero-ctas"><Link href="/sign-up" className="btn btn-primary btn-large">Build your workspace <ArrowRight size={17} /></Link><span className="hero-note">Private by design. Yours to shape.</span></div>
      </div>
      <div className="hero-visual rise-in" aria-label="Illustration of an organized job search workspace">
        <div className="orbit orbit-one" /><div className="orbit orbit-two" />
        <div className="hero-sun" />
        <div className="hero-paper paper-back"><div className="paper-line short" /><div className="paper-line" /><div className="paper-line medium" /><div className="paper-line" /></div>
        <div className="hero-paper paper-front"><div className="paper-caption">YOUR SEARCH, IN MOTION</div><div className="paper-title">The right role<br />is getting closer.</div><div className="mini-track"><i /><i /><i /><i /></div><div className="paper-foot"><span>4 meaningful leads</span><ArrowUpRight size={14} /></div></div>
        <div className="float-note"><span className="float-check"><Check size={13} /></span><span><b>One next step</b><small>Follow up with Marlowe</small></span></div>
        <div className="hero-index">01 / 03 <span /> MAKE IT YOURS</div>
      </div>
    </section>
    <section className="manifesto">
      <div className="manifesto-kicker">A BETTER KIND OF JOB SEARCH</div>
      <div className="manifesto-body"><h2>Less juggling.<br /><span>More moving forward.</span></h2><p>Job hunting asks you to be researcher, storyteller, and project manager all at once. Nextstep brings those threads together so your energy stays on the work that matters.</p></div>
    </section>
    <section className="feature-row">
      <div className="feature-intro"><span className="section-number">01 — FIND</span><h3>Good leads,<br />not another feed.</h3><p>Search with your real targets in mind. Save the ones worth a closer look.</p></div>
      <div className="feature-visual search-visual"><div className="search-pill"><Search size={16} /><span>Product designer</span><span className="search-chip">Remote</span></div><div className="lead-card"><span className="lead-icon">M</span><div><b>Senior Product Designer</b><small>Marlowe Studio · Remote</small></div><Bookmark size={16} /></div><div className="lead-card muted-card"><span className="lead-icon gold">F</span><div><b>Product Design Lead</b><small>Fieldwork · New York, NY</small></div><Bookmark size={16} /></div></div>
      <div className="feature-visual note-visual"><div className="note-top"><FileText size={16} /><span>YOUR SOURCE RESUME</span><span className="truth-label">THE TRUTH, FIRST</span></div><div className="note-title">A foundation that<br />sounds like you.</div><div className="note-lines"><i /><i /><i /></div><div className="note-footer"><span>3 roles in focus</span><ArrowUpRight size={15} /></div></div>
    </section>
    <section className="bottom-cta"><div><span className="section-number">A LITTLE MORE CLARITY</span><h2>Start where you are.</h2><p>Your next step doesn’t need to be a big one.</p></div><Link href="/sign-up" className="btn btn-dark btn-large">Create your workspace <ArrowRight size={17} /></Link></section>
    <footer className="landing-footer"><BrandMark /><span>A thoughtful place to keep moving.</span><span>© Nextstep</span></footer>
  </main>;
}

function SignInPage() {
  return <AuthFrame><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></AuthFrame>;
}
function SignUpPage() {
  return <AuthFrame><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></AuthFrame>;
}
function AuthFrame({ children }: { children: ReactNode }) {
  return <div className="auth-frame app-grain"><div className="auth-aside"><Link href="/" className="brand-link"><BrandMark inverse /></Link><div className="auth-aside-message"><span className="eyebrow light-eyebrow">YOUR SEARCH, WITH ROOM TO THINK</span><h1>One clear step<br />at a time.</h1><p>A private space for the work behind your next opportunity.</p></div><div className="auth-aside-footer">Your story stays yours.</div></div><div className="auth-content"><Link href="/" className="mobile-brand"><BrandMark /></Link>{children}</div></div>;
}

function ClerkCacheSync() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const prev = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const next = user?.id ?? null;
    if (prev.current !== undefined && prev.current !== next) client.clear();
    prev.current = next;
  }), [addListener, client]);
  return null;
}

function HomeRoute() {
  return <><Show when="signed-in"><Dashboard /></Show><Show when="signed-out"><Landing /></Show></>;
}
function Protected({ children }: { children: ReactNode }) {
  return <><Show when="signed-in">{children}</Show><Show when="signed-out"><Redirect to="/" /></Show></>;
}
function GuardedDashboard() { return <Protected><Dashboard /></Protected>; }
function GuardedJobs() { return <Protected><JobsPage /></Protected>; }
function GuardedProfile() { return <Protected><ProfilePage /></Protected>; }

function Shell({ children, active, title }: { children: ReactNode; active: 'home' | 'jobs' | 'profile'; title: string }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [menuOpen, setMenuOpen] = useState(false);
  const displayName = user?.firstName || user?.emailAddresses?.[0]?.emailAddress?.split('@')[0] || 'Your workspace';
  return <div className="workspace">
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <Link href="/" className="brand-link sidebar-brand"><BrandMark inverse /></Link>
      <div className="side-caption">YOUR WORKSPACE</div>
      <nav className="side-nav">
        <Link href="/" className={`side-link ${active === 'home' ? 'side-active' : ''}`}><LayoutDashboard size={17} /><span>Overview</span>{active === 'home' && <i />}</Link>
        <Link href="/jobs" className={`side-link ${active === 'jobs' ? 'side-active' : ''}`}><BriefcaseBusiness size={17} /><span>Job search</span>{active === 'jobs' && <i />}</Link>
        <Link href="/profile" className={`side-link ${active === 'profile' ? 'side-active' : ''}`}><UserRound size={17} /><span>My profile</span>{active === 'profile' && <i />}</Link>
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-tip"><div className="tip-icon"><Target size={16} /></div><b>Keep it true.</b><p>Your source resume is the foundation for every tailored draft.</p><Link href="/profile">Review your profile <ArrowRight size={12} /></Link></div>
        <button className="account-row" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out"><span className="avatar">{displayName.slice(0, 1).toUpperCase()}</span><span className="account-name"><b>{displayName}</b><small>Personal workspace</small></span><LogOut size={15} /></button>
      </div>
    </aside>
    {menuOpen && <button aria-label="Close menu" className="mobile-scrim" onClick={() => setMenuOpen(false)} />}
    <div className="main-column">
      <header className="topbar"><button className="mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Open navigation" data-testid="button-open-menu">{menuOpen ? <X size={20} /> : <Menu size={20} />}</button><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><b>{title}</b></div><div className="topbar-right"><span className="today-chip">{new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span><span className="top-avatar">{displayName.slice(0, 1).toUpperCase()}</span></div></header>
      <main className="page-content">{children}</main>
    </div>
  </div>;
}

function ErrorNotice({ onRetry, message = 'We couldn’t load this just now.' }: { onRetry: () => void; message?: string }) {
  return <div className="error-notice"><CircleAlert size={18} /><div><b>Something didn’t come through</b><span>{message}</span></div><button onClick={onRetry} data-testid="button-retry"><RefreshCw size={14} /> Try again</button></div>;
}
function SkeletonRows({ count = 3 }: { count?: number }) {
  return <div className="skeleton-stack" aria-label="Loading"><div className="skeleton skeleton-title" />{Array.from({ length: count }, (_, i) => <div className="skeleton-row" key={i}><div className="skeleton skeleton-icon" /><div className="skeleton-copy"><i className="skeleton" /><i className="skeleton" /></div></div>)}</div>;
}
function PageHeading({ eyebrow, title, subtitle, right }: { eyebrow: string; title: string; subtitle: string; right?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow page-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{right && <div className="heading-action">{right}</div>}</div>;
}
function initials(name: string) { return name.split(/\s+/).map((n) => n[0]).slice(0, 2).join('').toUpperCase() || '•'; }
function companyColor(company: string) {
  const colors = ['#dae8dd', '#f1e2ca', '#e7e0ed', '#dce8eb', '#f1dfdc'];
  return colors[(company.charCodeAt(0) || 0) % colors.length];
}
function JobLine({ job, compact = false, actions }: { job: TrackedJob; compact?: boolean; actions?: ReactNode }) {
  return <article className={`job-line ${compact ? 'job-line-compact' : ''}`} data-testid={`job-row-${job.id}`}>
    <div className="company-monogram" style={{ background: companyColor(job.company) }}>{initials(job.company)}</div>
    <div className="job-line-main"><div className="job-title-row"><h3>{job.title}</h3><StatusBadge status={job.status} /></div><div className="job-meta">{job.company}<span>·</span>{job.location || 'Location not listed'}{job.remote && <span className="remote-tag">Remote</span>}</div></div>
    {!compact && <div className="job-date">{job.postedAt ? relativeDate(job.postedAt) : 'Recently saved'}</div>}
    {actions && <div className="job-line-actions">{actions}</div>}
  </article>;
}
function relativeDate(value: string) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days}d ago`;
}
const statusNames: Record<TrackedJobStatus, string> = { saved: 'Saved', applied: 'Applied', interviewing: 'Interviewing', offer: 'Offer', rejected: 'Not moving forward', withdrawn: 'Withdrawn' };
function StatusBadge({ status }: { status: TrackedJobStatus }) {
  return <span className={`status-badge status-${status}`} data-testid={`status-${status}`}>{status === 'interviewing' ? <span className="status-live" /> : null}{statusNames[status]}</span>;
}
function EmptyState({ icon, title, copy, action }: { icon: ReactNode; title: string; copy: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{copy}</p>{action}</div>;
}

function Dashboard() {
  const dashboard = useGetDashboard();
  const profile = useGetProfile();
  const client = useQueryClient();
  const { user } = useUser();
  const summary = dashboard.data;
  const name = profile.data?.fullName || user?.firstName || 'there';
  const total = summary ? summary.saved + summary.applied + summary.interviewing + summary.offers : 0;
  return <Shell active="home" title="Overview">
    <PageHeading eyebrow="YOUR JOB SEARCH" title={`Good ${greeting()}, ${name.split(' ')[0]}.`} subtitle="A little progress, thoughtfully kept." right={<Link href="/jobs" className="btn btn-primary"><Search size={15} /> Find a role</Link>} />
    {dashboard.isLoading ? <SkeletonRows count={4} /> : dashboard.isError ? <ErrorNotice onRetry={() => client.invalidateQueries({ queryKey: getGetDashboardQueryKey() })} message="Your pipeline summary is temporarily unavailable." /> : <>
      <div className="dashboard-feature">
        <div className="feature-copy"><span className="feature-label"><span className="live-pip" /> YOUR PIPELINE</span><h2>{total === 0 ? 'Your search starts here.' : `${total} ${total === 1 ? 'opportunity' : 'opportunities'} in motion.`}</h2><p>{total === 0 ? 'Save a role that feels right. We’ll keep your next step close.' : 'Every lead has a place. Keep the momentum moving at your own pace.'}</p><Link href="/jobs" className="feature-link">{total === 0 ? 'Explore open roles' : 'View your pipeline'} <ArrowRight size={15} /></Link></div>
        <div className="feature-mark"><div className="mark-circle circle-outer" /><div className="mark-circle circle-mid" /><div className="mark-circle circle-inner"><ArrowUpRight size={26} /></div><span className="mark-small-label">NEXT<br />STEP</span></div>
        <div className="feature-index">01 <span>/</span> YOUR SEARCH</div>
      </div>
      <section className="metric-grid" aria-label="Pipeline totals">
        <Metric label="Saved" value={summary?.saved ?? 0} icon={<Bookmark size={16} />} tone="ochre" />
        <Metric label="Applied" value={summary?.applied ?? 0} icon={<ArrowUpRight size={17} />} tone="sage" />
        <Metric label="Interviewing" value={summary?.interviewing ?? 0} icon={<Clock3 size={16} />} tone="blue" />
        <Metric label="Offers" value={summary?.offers ?? 0} icon={<Sparkles size={16} />} tone="coral" />
      </section>
      <section className="recent-section">
        <div className="section-head"><div><div className="eyebrow">KEEP THE THREAD</div><h2>Recently in your orbit</h2></div><Link href="/jobs" className="subtle-link">All jobs <ArrowRight size={14} /></Link></div>
        {summary?.recentJobs.length ? <div className="job-list recent-list">{summary.recentJobs.slice(0, 4).map((job) => <Link href="/jobs" className="job-link" key={job.id}><JobLine job={job} compact /><ArrowRight size={15} className="recent-arrow" /></Link>)}</div> :
          <EmptyState icon={<BriefcaseBusiness size={20} />} title="A clean slate, full of possibility." copy="When you save a role, it will show up here with its next step." action={<Link href="/jobs" className="text-link with-arrow">Search for your next role <ArrowRight size={14} /></Link>} />}
      </section>
      <section className="profile-nudge"><div className="nudge-icon"><FileText size={17} /></div><div><b>Start with your source story</b><p>Your resume and preferences help keep every tailored draft grounded in what’s true.</p></div><Link href="/profile" className="nudge-link">Complete your profile <ArrowRight size={14} /></Link></section>
    </>}
  </Shell>;
}
function greeting() { const hour = new Date().getHours(); return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'; }
function Metric({ label, value, icon, tone }: { label: string; value: number; icon: ReactNode; tone: string }) {
  return <div className={`metric metric-${tone}`}><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><b>{value.toString().padStart(2, '0')}</b><div className="metric-foot"><span /> in your pipeline</div></div>;
}

function JobsPage() {
  const client = useQueryClient();
  const { data: profile } = useGetProfile();
  const jobsQuery = useListJobs();
  const search = useSearchJobs();
  const save = useSaveJob();
  const update = useUpdateJob();
  const remove = useDeleteJob();
  const [searchTitle, setSearchTitle] = useState('');
  const [searchLocation, setSearchLocation] = useState('');
  const [remote, setRemote] = useState(false);
  const remoteInitialized = useRef(false);
  const [days, setDays] = useState(14);
  const [filter, setFilter] = useState('all');
  const [selectedJob, setSelectedJob] = useState<TrackedJob | null>(null);
  const tracked = jobsQuery.data ?? [];
  useEffect(() => {
    if (profile && !remoteInitialized.current) {
      remoteInitialized.current = true;
      setRemote(profile.remoteOnly);
    }
  }, [profile]);
  const trackedSources = useMemo(() => new Set(tracked.map((j) => j.sourceId)), [tracked]);
  const visibleJobs = filter === 'all' ? tracked : tracked.filter((j) => j.status === filter);
  const results: JobSearchResult[] = search.data?.results ?? [];
  const invalidate = () => {
    client.invalidateQueries({ queryKey: getListJobsQueryKey() });
    client.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };
  const runSearch = (event: FormEvent) => {
    event.preventDefault();
    const input: JobSearchInput = {
      jobTitle: searchTitle.trim() || profile?.targetTitles?.[0] || '',
      location: searchLocation.trim() || profile?.location || '',
      countryCode: profile?.countryCode || 'US',
      remote,
      postedWithinDays: days, limit: 15,
      minSalaryUsd: profile?.minSalaryUsd ?? null, maxSalaryUsd: profile?.maxSalaryUsd ?? null,
    };
    search.mutate({ data: input });
  };
  const saveResult = (job: JobSearchResult) => {
    save.mutate({ data: { ...job, postedAt: job.postedAt ?? null, seniority: job.seniority ?? null, minSalaryUsd: job.minSalaryUsd ?? null, maxSalaryUsd: job.maxSalaryUsd ?? null } }, { onSuccess: invalidate });
  };
  const setStatus = (job: TrackedJob, status: TrackedJobStatus) => update.mutate({ jobId: job.id, data: { status, notes: job.notes } }, { onSuccess: invalidate });
  return <Shell active="jobs" title="Job search">
    <PageHeading eyebrow="FIND & FOLLOW THROUGH" title="Your job search" subtitle="Live leads on one side. Your next steps on the other." />
    <section className="search-panel">
      <div className="search-panel-head"><div><span className="search-panel-mark"><Search size={16} /></span><div><h2>Find a role worth your time</h2><p>Search active listings that fit the direction you’re heading.</p></div></div><span className="live-source"><i /> LIVE SEARCH</span></div>
      <form onSubmit={runSearch} className="job-search-form">
        <label className="field-wrap"><span>ROLE OR TITLE</span><div className="input-icon"><Search size={15} /><input value={searchTitle} onChange={(e) => setSearchTitle(e.target.value)} placeholder={profile?.targetTitles?.[0] || 'e.g. Product designer'} data-testid="input-job-title" /></div></label>
        <label className="field-wrap"><span>LOCATION</span><div className="input-icon"><MapPin size={15} /><input value={searchLocation} onChange={(e) => setSearchLocation(e.target.value)} placeholder={profile?.location || 'City or region'} data-testid="input-job-location" /></div></label>
        <label className="field-wrap days-field"><span>POSTED WITHIN</span><select value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="select-posted-within"><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option><option value={60}>60 days</option></select></label>
        <label className="remote-toggle"><input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} data-testid="checkbox-remote-only" /><span className="toggle-track" /><span>Remote</span></label>
        <AppButton type="submit" disabled={search.isPending} testId="button-search-jobs">{search.isPending ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />}{search.isPending ? 'Searching' : 'Search roles'}</AppButton>
      </form>
      <p className="search-credit-note">TheirStack charges one search credit per job returned. Each search is capped at 25 results.</p>
      {search.isError && <div className="inline-error"><CircleAlert size={15} /> Search couldn’t finish. Try adjusting your search or give it another moment.</div>}
      {(save.isError || update.isError || remove.isError) && <div className="inline-error"><CircleAlert size={15} /> That change didn’t save. Please try again.</div>}
    </section>
    <div className="jobs-columns">
      <section className="jobs-column">
        <div className="section-head job-section-head"><div><div className="eyebrow">OUT IN THE WORLD</div><h2>{search.data ? `${search.data.total} roles found` : 'Live opportunities'}</h2></div>{search.data?.truncated && <span className="results-note">Showing the closest matches</span>}</div>
        {search.isPending ? <SkeletonRows count={3} /> : results.length ? <div className="result-list">{results.map((job) => {
          const isSaved = trackedSources.has(job.sourceId);
          return <article className="result-card" key={job.sourceId} data-testid={`search-result-${job.sourceId}`}>
            <div className="result-card-top"><div className="company-monogram" style={{ background: companyColor(job.company) }}>{initials(job.company)}</div><div className="result-heading"><h3>{job.title}</h3><div className="job-meta">{job.company}<span>·</span>{job.location || 'Location not listed'}</div></div><a href={job.url} className="external-link" target="_blank" rel="noreferrer" aria-label={`Open ${job.title} at ${job.company}`} data-testid={`link-job-${job.sourceId}`}><ExternalLink size={15} /></a></div>
            <div className="result-tags">{job.remote && <span className="soft-tag"><Globe2 size={12} /> Remote</span>}{job.seniority && <span className="soft-tag">{job.seniority}</span>}{job.postedAt && <span className="soft-tag"><Clock3 size={12} /> {relativeDate(job.postedAt)}</span>}{job.minSalaryUsd && <span className="soft-tag">${Math.round(job.minSalaryUsd / 1000)}k{job.maxSalaryUsd ? `–$${Math.round(job.maxSalaryUsd / 1000)}k` : '+'}</span>}</div>
            <p className="result-description">{job.description}</p>
            <div className="result-footer"><span>Found for your search</span><AppButton variant={isSaved ? 'quiet' : 'secondary'} onClick={() => !isSaved && saveResult(job)} disabled={isSaved || save.isPending} testId={`button-save-${job.sourceId}`}>{isSaved ? <><Check size={14} /> Saved</> : <><Bookmark size={14} /> Save role</>}</AppButton></div>
          </article>;
        })}</div> : <EmptyState icon={<Search size={19} />} title={search.data ? 'Nothing in this search yet.' : 'Start with a role in mind.'} copy={search.data ? 'Try a nearby title or widen the posting window.' : 'Search current openings that match what you’re looking for.'} action={!search.data ? <button onClick={() => { setSearchTitle(profile?.targetTitles?.[0] || ''); setSearchLocation(profile?.location || ''); }} className="text-link with-arrow">Use my profile preferences <ArrowRight size={14} /></button> : undefined} />}
      </section>
      <section className="jobs-column pipeline-column">
        <div className="section-head job-section-head"><div><div className="eyebrow">YOUR SHORTLIST</div><h2>Saved & in motion</h2></div><span className="count-pill">{tracked.length}</span></div>
        <div className="filter-tabs" role="tablist" aria-label="Filter pipeline">
          {['all', 'saved', 'applied', 'interviewing', 'offer'].map((tab) => <button key={tab} role="tab" aria-selected={filter === tab} onClick={() => setFilter(tab)} className={filter === tab ? 'filter-active' : ''} data-testid={`filter-${tab}`}>{tab === 'all' ? 'All' : statusNames[tab as TrackedJobStatus]}{tab === 'all' && <span>{tracked.length}</span>}</button>)}
        </div>
        {jobsQuery.isLoading ? <SkeletonRows count={3} /> : jobsQuery.isError ? <ErrorNotice onRetry={() => client.invalidateQueries({ queryKey: getListJobsQueryKey() })} message="Your saved roles are temporarily unavailable." /> : visibleJobs.length ? <div className="pipeline-list">{visibleJobs.map((job) => <TrackedJobCard key={job.id} job={job} onStatus={setStatus} onUpdate={(notes, status) => update.mutate({ jobId: job.id, data: { notes, status } }, { onSuccess: invalidate })} onDelete={() => { if (window.confirm(`Remove ${job.title} at ${job.company} from your pipeline?`)) remove.mutate({ jobId: job.id }, { onSuccess: invalidate }); }} onDraft={() => setSelectedJob(job)} busy={update.isPending || remove.isPending} />)}</div> : <EmptyState icon={<Bookmark size={19} />} title={filter === 'all' ? 'Your shortlist starts here.' : `No ${statusNames[filter as TrackedJobStatus].toLowerCase()} roles yet.`} copy="Save a live lead to keep it close, then track each step as it happens." />}
      </section>
    </div>
    {selectedJob && <DraftDialog job={selectedJob} onClose={() => setSelectedJob(null)} />}
  </Shell>;
}

function TrackedJobCard({ job, onStatus, onUpdate, onDelete, onDraft, busy }: {
  job: TrackedJob; onStatus: (job: TrackedJob, status: TrackedJobStatus) => void;
  onUpdate: (notes: string, status: TrackedJobStatus) => void; onDelete: () => void; onDraft: () => void; busy: boolean;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(job.notes);
  const options: TrackedJobStatus[] = ['saved', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn'];
  return <article className="pipeline-card" data-testid={`pipeline-card-${job.id}`}>
    <div className="pipeline-card-top"><div className="company-monogram small-monogram" style={{ background: companyColor(job.company) }}>{initials(job.company)}</div><div className="pipeline-title"><h3>{job.title}</h3><span>{job.company} · {job.location || 'Location not listed'}</span></div><button className="icon-button remove-button" title="Remove from pipeline" onClick={onDelete} disabled={busy} data-testid={`button-delete-job-${job.id}`}><Trash2 size={14} /></button></div>
    <div className="pipeline-controls"><label className="status-select-wrap"><span>STATUS</span><select value={job.status} disabled={busy} onChange={(e) => onStatus(job, e.target.value as TrackedJobStatus)} data-testid={`select-status-${job.id}`}>{options.map((status) => <option key={status} value={status}>{statusNames[status]}</option>)}</select><ChevronDown size={13} /></label><button className="text-action" onClick={onDraft} data-testid={`button-draft-${job.id}`}><FileText size={14} /> Resume draft</button><a className="text-action" href={job.url} target="_blank" rel="noreferrer" data-testid={`link-application-${job.id}`}><ExternalLink size={14} /> Job post</a></div>
    <div className="notes-row"><span className="notes-label">NEXT STEP</span>{editingNotes ? <div className="notes-edit"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a reminder or next step…" maxLength={5000} data-testid={`textarea-notes-${job.id}`} /><div><button onClick={() => { setNotes(job.notes); setEditingNotes(false); }} className="text-action">Cancel</button><AppButton variant="secondary" onClick={() => { onUpdate(notes, job.status); setEditingNotes(false); }} disabled={busy} testId={`button-save-notes-${job.id}`}><Save size={13} /> Save</AppButton></div></div> : <button className={`notes-content ${job.notes ? '' : 'notes-placeholder'}`} onClick={() => setEditingNotes(true)} data-testid={`button-edit-notes-${job.id}`}><span>{job.notes || 'Add a note for your future self'}</span><Pencil size={13} /></button>}</div>
  </article>;
}

function DraftDialog({ job, onClose }: { job: TrackedJob; onClose: () => void }) {
  const client = useQueryClient();
  const draftsQuery = useListResumeDrafts(job.id, { query: { queryKey: getListResumeDraftsQueryKey(job.id) } });
  const createDraft = useCreateResumeDraft();
  const updateDraft = useUpdateResumeDraft();
  const [prompt, setPrompt] = useState('Tailor my resume for this role. Keep every claim grounded in my source resume and highlight the most relevant experience.');
  const [activeDraft, setActiveDraft] = useState<ResumeDraft | null>(null);
  const [content, setContent] = useState('');
  const [downloadId, setDownloadId] = useState(0);
  const download = useDownloadResumeDraft(downloadId, { query: { enabled: downloadId > 0, queryKey: getDownloadResumeDraftQueryKey(downloadId) } });
  useEffect(() => {
    if (download.data) {
      const blob = new Blob([download.data], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `${job.company}-${job.title}-resume.txt`.replace(/[^a-z0-9-]/gi, '-');
      link.click(); URL.revokeObjectURL(url); setDownloadId(0);
    }
  }, [download.data, job.company, job.title]);
  const openDraft = (draft: ResumeDraft) => { setActiveDraft(draft); setContent(draft.content); };
  return <div className="modal-shade" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}><section className="draft-modal" role="dialog" aria-modal="true" aria-labelledby="draft-title">
    <header className="modal-header"><div><div className="eyebrow">MAKE IT SOUND LIKE YOU</div><h2 id="draft-title">Resume draft</h2><p>{job.title} · {job.company}</p></div><button className="icon-button" onClick={onClose} aria-label="Close draft"><X size={18} /></button></header>
    <div className="modal-body">
      {draftsQuery.isLoading ? <SkeletonRows count={2} /> : draftsQuery.isError ? <ErrorNotice onRetry={() => client.invalidateQueries({ queryKey: getListResumeDraftsQueryKey(job.id) })} message="Your drafts couldn’t be loaded." /> :
        <div className="draft-layout"><div className="draft-sidebar"><div className="draft-sidebar-head"><span>YOUR DRAFTS</span><AppButton variant="quiet" onClick={() => { setActiveDraft(null); setContent(''); }} testId="button-new-draft"><Plus size={14} /> New</AppButton></div>
          {draftsQuery.data?.length ? draftsQuery.data.map((draft, i) => <button className={`draft-list-item ${activeDraft?.id === draft.id ? 'draft-selected' : ''}`} key={draft.id} onClick={() => openDraft(draft)} data-testid={`button-open-draft-${draft.id}`}><span className="draft-list-dot">{String(i + 1).padStart(2, '0')}</span><span><b>Draft {i + 1}</b><small>{new Date(draft.updatedAt).toLocaleDateString()}</small></span><ArrowRight size={13} /></button>) : <p className="draft-empty-note">No drafts yet. Start with a thoughtful prompt.</p>}
        </div><div className="draft-editor">
          {!activeDraft ? <><label className="field-wrap"><span>TAILORING DIRECTION</span><textarea className="prompt-area" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={4000} data-testid="textarea-draft-prompt" /></label><div className="draft-guidance"><Sparkles size={15} /><span>Build on your source resume. Never add experience or claims that aren’t yours.</span></div><AppButton onClick={() => createDraft.mutate({ jobId: job.id, data: { prompt } }, { onSuccess: (draft) => { openDraft(draft); client.invalidateQueries({ queryKey: getListResumeDraftsQueryKey(job.id) }); } })} disabled={createDraft.isPending || !prompt.trim()} testId="button-create-draft" className="full-width">{createDraft.isPending ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{createDraft.isPending ? 'Creating your draft' : 'Create tailored draft'}</AppButton>{createDraft.isError && <div className="inline-error"><CircleAlert size={14} /> Couldn’t create the draft. Try again.</div>}</> :
            <><div className="editor-head"><div><span className="eyebrow">EDITABLE DRAFT</span><p>Review each line before you use it.</p></div><button className="text-action" onClick={() => setDownloadId(activeDraft.id)} disabled={download.isFetching} data-testid="button-download-draft">{download.isFetching ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />} Download</button></div><textarea className="resume-editor" value={content} onChange={(e) => setContent(e.target.value)} maxLength={50000} data-testid="textarea-resume-content" /><div className="editor-actions"><AppButton variant="secondary" onClick={() => { setActiveDraft(null); }} testId="button-back-drafts"><ArrowLeft size={14} /> Draft list</AppButton><AppButton onClick={() => updateDraft.mutate({ draftId: activeDraft.id, data: { content } }, { onSuccess: (updated) => { setActiveDraft(updated); setContent(updated.content); client.invalidateQueries({ queryKey: getListResumeDraftsQueryKey(job.id) }); } })} disabled={updateDraft.isPending || !content.trim()} testId="button-save-draft">{updateDraft.isPending ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}{updateDraft.isPending ? 'Saving' : 'Save changes'}</AppButton></div>{updateDraft.isError && <div className="inline-error"><CircleAlert size={14} /> The draft couldn’t be saved.</div>}</>}
        </div></div>
      }
    </div>
  </section></div>;
}

const blankProfile: CandidateProfileInput = {
  fullName: '', baseResume: '', linkedinNotes: '', targetTitles: [], location: '', countryCode: 'US',
  remoteOnly: false, minSalaryUsd: null, maxSalaryUsd: null, promptPreferences: '',
};
function ProfilePage() {
  const client = useQueryClient();
  const profileQuery = useGetProfile();
  const saveProfile = useSaveProfile();
  const [form, setForm] = useState<CandidateProfileInput>(blankProfile);
  const [titlesText, setTitlesText] = useState('');
  const [dirty, setDirty] = useState(false);
  const initialized = useRef(false);
  useEffect(() => {
    if (profileQuery.data && !initialized.current) {
      initialized.current = true;
      const candidate = profileQuery.data as CandidateProfile;
      const editable: CandidateProfileInput = {
        fullName: candidate.fullName, baseResume: candidate.baseResume, linkedinNotes: candidate.linkedinNotes,
        targetTitles: candidate.targetTitles, location: candidate.location, countryCode: candidate.countryCode,
        remoteOnly: candidate.remoteOnly, minSalaryUsd: candidate.minSalaryUsd, maxSalaryUsd: candidate.maxSalaryUsd,
        promptPreferences: candidate.promptPreferences,
      };
      setForm(editable);
      setTitlesText(editable.targetTitles.join(', '));
    }
  }, [profileQuery.data]);
  const change = <K extends keyof CandidateProfileInput>(key: K, value: CandidateProfileInput[K]) => { setDirty(true); setForm((current) => ({ ...current, [key]: value })); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const targetTitles = titlesText.split(',').map((title) => title.trim()).filter(Boolean).slice(0, 20);
    const data = { ...form, targetTitles, minSalaryUsd: form.minSalaryUsd === null ? null : Number(form.minSalaryUsd), maxSalaryUsd: form.maxSalaryUsd === null ? null : Number(form.maxSalaryUsd) };
    saveProfile.mutate({ data }, { onSuccess: () => { setDirty(false); client.invalidateQueries({ queryKey: getGetProfileQueryKey() }); } });
  };
  const updateNumber = (key: 'minSalaryUsd' | 'maxSalaryUsd', value: string) => change(key, value ? Number(value) : null);
  return <Shell active="profile" title="My profile">
    <PageHeading eyebrow="YOUR SOURCE OF TRUTH" title="Your story, in one place." subtitle="Keep the source material honest. Every tailored draft starts here." right={<span className="save-status">{saveProfile.isSuccess && !dirty ? <><CheckCircle2 size={14} /> Saved just now</> : dirty ? 'Unsaved changes' : profileQuery.data?.updatedAt ? `Updated ${new Date(profileQuery.data.updatedAt).toLocaleDateString()}` : 'Not saved yet'}</span>} />
    {profileQuery.isLoading ? <SkeletonRows count={5} /> : profileQuery.isError ? <ErrorNotice onRetry={() => client.invalidateQueries({ queryKey: getGetProfileQueryKey() })} message="Your profile couldn’t be loaded." /> : <form className="profile-form" onSubmit={submit}>
      <div className="profile-main">
        <section className="profile-card"><div className="profile-card-header"><div className="section-icon"><UserRound size={17} /></div><div><h2>Who you are</h2><p>The details that anchor your search.</p></div><span className="card-number">01</span></div>
          <div className="form-grid"><label className="field-wrap"><span>FULL NAME</span><input value={form.fullName} onChange={(e) => change('fullName', e.target.value)} maxLength={200} placeholder="Your name" data-testid="input-full-name" /></label><label className="field-wrap"><span>LOCATION</span><input value={form.location} onChange={(e) => change('location', e.target.value)} maxLength={200} placeholder="City, region" data-testid="input-profile-location" /></label><label className="field-wrap"><span>COUNTRY CODE</span><input value={form.countryCode} onChange={(e) => change('countryCode', e.target.value.toUpperCase().slice(0, 2))} maxLength={2} placeholder="US" data-testid="input-country-code" /></label><label className="remote-profile"><span><b>Remote roles only</b><small>Keep location flexible and prioritize remote opportunities.</small></span><input type="checkbox" checked={form.remoteOnly} onChange={(e) => change('remoteOnly', e.target.checked)} data-testid="checkbox-profile-remote" /></label></div>
        </section>
        <section className="profile-card"><div className="profile-card-header"><div className="section-icon section-icon-gold"><FileText size={17} /></div><div><h2>Source resume</h2><p>Your accurate baseline. Tailoring never invents.</p></div><span className="truth-label profile-truth">SOURCE MATERIAL</span></div>
          <label className="field-wrap"><span>RESUME TEXT</span><textarea className="resume-source-area" value={form.baseResume} onChange={(e) => change('baseResume', e.target.value)} maxLength={50000} placeholder="Paste your resume here. Include the experience, skills, and outcomes you can stand behind." data-testid="textarea-base-resume" /><small className="field-caption">{form.baseResume.length.toLocaleString()} / 50,000 characters</small></label>
        </section>
        <section className="profile-card"><div className="profile-card-header"><div className="section-icon section-icon-blue"><Link2 size={17} /></div><div><h2>LinkedIn notes</h2><p>Keep context that doesn’t fit neatly on a resume.</p></div><span className="card-number">03</span></div>
          <label className="field-wrap"><span>NOTES & CONTEXT</span><textarea className="linkedin-area" value={form.linkedinNotes} onChange={(e) => change('linkedinNotes', e.target.value)} maxLength={20000} placeholder="Projects, strengths, preferred language, or anything you want to remember…" data-testid="textarea-linkedin-notes" /></label>
        </section>
      </div>
      <aside className="profile-side">
        <section className="profile-card side-card"><div className="profile-card-header"><div className="section-icon"><Target size={17} /></div><div><h2>Where you’re headed</h2><p>Shape the opportunities you see.</p></div></div>
          <label className="field-wrap"><span>TARGET TITLES</span><input value={titlesText} onChange={(e) => { setTitlesText(e.target.value); setDirty(true); }} placeholder="Product designer, UX lead" data-testid="input-target-titles" /><small className="field-caption">Separate titles with commas</small></label>
          <div className="salary-heading"><span>MINIMUM SALARY</span><span>USD / YEAR</span></div><div className="salary-input"><span>$</span><input type="number" min="0" value={form.minSalaryUsd ?? ''} onChange={(e) => updateNumber('minSalaryUsd', e.target.value)} placeholder="—" data-testid="input-min-salary" /></div>
          <div className="salary-heading salary-max-heading"><span>UPPER RANGE</span><span>OPTIONAL</span></div><div className="salary-input"><span>$</span><input type="number" min="0" value={form.maxSalaryUsd ?? ''} onChange={(e) => updateNumber('maxSalaryUsd', e.target.value)} placeholder="—" data-testid="input-max-salary" /></div>
        </section>
        <section className="profile-card side-card preferences-card"><div className="profile-card-header"><div className="section-icon section-icon-gold"><Settings2 size={17} /></div><div><h2>Tailoring preferences</h2><p>Help drafts keep your voice.</p></div></div><label className="field-wrap"><span>GUIDANCE FOR DRAFTS</span><textarea className="preferences-area" value={form.promptPreferences} onChange={(e) => change('promptPreferences', e.target.value)} maxLength={4000} placeholder="Tone, things to emphasize, or details to avoid…" data-testid="textarea-prompt-preferences" /></label><div className="privacy-note"><CircleHelp size={14} /><span>Your resume is yours. Review every draft before sharing.</span></div></section>
        <AppButton type="submit" disabled={saveProfile.isPending || !dirty || !form.fullName.trim() || form.countryCode.length !== 2} testId="button-save-profile" className="profile-save">{saveProfile.isPending ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}{saveProfile.isPending ? 'Saving profile' : 'Save your profile'}</AppButton>
        {saveProfile.isError && <div className="inline-error"><CircleAlert size={14} /> Your changes weren’t saved. Please try again.</div>}
      </aside>
      <div className="mobile-profile-save"><AppButton type="submit" disabled={saveProfile.isPending || !dirty || !form.fullName.trim() || form.countryCode.length !== 2} testId="button-save-profile-mobile" className="full-width">{saveProfile.isPending ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}{saveProfile.isPending ? 'Saving profile' : 'Save your profile'}</AppButton></div>
    </form>}
  </Shell>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch>
    <Route path="/" component={HomeRoute} />
    <Route path="/jobs" component={GuardedJobs} />
    <Route path="/profile" component={GuardedProfile} />
    <Route path="/sign-in/*?" component={SignInPage} />
    <Route path="/sign-up/*?" component={SignUpPage} />
    <Route component={NotFound} />
  </Switch></ErrorBoundary>;
}
function ClerkApp() {
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance}
    signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Your next step is right where you left it.' } }, signUp: { start: { title: 'Make room for what’s next', subtitle: 'Build a thoughtful home for your job search.' } } }}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
  ><QueryClientProvider client={queryClient}><ClerkCacheSync /><Router /></QueryClientProvider></ClerkProvider>;
}
function App() { return <WouterRouter base={basePath}><ClerkApp /></WouterRouter>; }
export default App;
