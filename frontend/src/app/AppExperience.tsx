import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2,
  Copy, ExternalLink, FileText, Landmark, Loader2, Menu, PiggyBank, Receipt, ShieldCheck, Wallet, X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { LOANCH_CONTRACT_ADDRESS } from '../contracts/addresses'
import { botChainConfig } from '../contracts/config'
import { actionError, amountText, eligibilityText, parseAmount, previewLoan, readActivity, readLoan, readTransaction, submitAction, type ActionKind, type ActivityItem, type Loan, type TxProgress } from '../contracts/loanch'
import { expectedChainId, shortAddress, useWallet, type WalletState } from './useWallet'
import { usePool } from './usePool'
import './app.css'

type Wallet = ReturnType<typeof useWallet>
type Pool = ReturnType<typeof usePool>
type TransactionStage = 'idle' | 'awaiting-wallet' | 'submitted' | 'confirming' | 'confirmed' | 'failed'
type FormKind = Exclude<ActionKind, 'claim'>

const nav = [
  { href: '/app/save', label: 'Save', icon: PiggyBank },
  { href: '/app/borrow', label: 'Borrow', icon: Landmark },
  { href: '/app/activity', label: 'Activity', icon: Receipt },
  { href: '/app/transparency', label: 'Transparency', icon: FileText },
]

const transactionLabels: Record<TransactionStage, string> = {
  idle: 'Idle',
  'awaiting-wallet': 'Awaiting wallet',
  submitted: 'Submitted',
  confirming: 'Confirming',
  confirmed: 'Confirmed',
  failed: 'Failed',
}

function useAppPath() {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const navigate = useCallback((href: string) => {
    if (window.location.pathname === href) return
    window.history.pushState(null, '', href)
    setPath(href)
    window.scrollTo(0, 0)
  }, [])
  return { path, navigate }
}

function AppLink({ href, navigate, children, className = '', current, title }: {
  href: string
  navigate: (href: string) => void
  children: ReactNode
  className?: string
  current?: boolean
  title?: string
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(href)
  }
  return <a href={href} className={className} title={title} aria-current={current ? 'page' : undefined} onClick={onClick}>{children}</a>
}

function ActionLink({ href, navigate, children, secondary = false }: {
  href: string
  navigate: (href: string) => void
  children: ReactNode
  secondary?: boolean
}) {
  return <AppLink href={href} navigate={navigate} className={`la-button ${secondary ? 'la-button--secondary' : 'la-button--primary'}`}>
    {children}<ArrowRight size={17} aria-hidden="true" />
  </AppLink>
}

function PageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <div className="la-page-heading">
    <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {children && <div className="la-page-actions">{children}</div>}
  </div>
}

function Section({ title, description, children, className = '' }: {
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return <section className={`la-section ${className}`} aria-label={title}>
    <div className="la-section-heading"><h2>{title}</h2>{description && <p>{description}</p>}</div>
    {children}
  </section>
}

function Notice({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warning' | 'success' }) {
  const Icon = tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Loader2
  return (
    <div className={`la-notice la-notice--${tone}`} role={tone === 'warning' ? 'alert' : 'status'}>
      <Icon size={16} className={`la-notice-icon ${tone === 'neutral' ? 'la-spinner' : ''}`} aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

function EmptyState({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className="la-empty">
    <div className="la-empty-mark" aria-hidden="true"><FileText size={26} strokeWidth={1.5} /></div>
    <h3>{title}</h3><p>{description}</p>{children && <div className="la-empty-actions">{children}</div>}
  </div>
}

function DataLine({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="la-data-line"><span>{label}{hint && <small>{hint}</small>}</span><strong>{value}</strong></div>
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="la-metric"><h3>{label}</h3><strong>{value}</strong>{detail && <p>{detail}</p>}</div>
}

function PoolNotice({ pool }: { pool: Pool }) {
  return pool.error ? <Notice tone="warning">{pool.error}</Notice>
    : pool.loading ? <Notice>Reading verified pool data…</Notice> : null
}

function TransactionStatusTracker({ stage = 'idle' }: { stage?: TransactionStage }) {
  const sequence: TransactionStage[] = ['idle', 'awaiting-wallet', 'submitted', 'confirming', 'confirmed']
  const activeIndex = stage === 'failed' ? -1 : sequence.indexOf(stage)
  return <div className={`la-tracker ${stage === 'failed' ? 'la-tracker--failed' : ''}`} aria-live="polite" aria-atomic="true">
    <div className="la-tracker-top"><h3>Transaction status</h3><span>{transactionLabels[stage]}</span></div>
    <ol>
      {sequence.map((step, index) => {
        const label = transactionLabels[step]
        return <li key={step} className={index < activeIndex ? 'is-complete' : index === activeIndex ? 'is-current' : ''}>
          <span aria-hidden="true">{index < activeIndex ? <Check size={13} /> : index + 1}</span>{label}
        </li>
      })}
      {stage === 'failed' && <li className="is-current is-error"><span aria-hidden="true"><X size={13} /></span>Failed</li>}
    </ol>
    <p>{stage === 'idle' ? 'No transaction has been started.' : stage === 'failed' ? 'The transaction did not complete.' : `Current state: ${transactionLabels[stage]}.`}</p>
  </div>
}

function WalletPanel({ wallet, compact = false }: { wallet: Wallet; compact?: boolean }) {
  const { status, address, chainId, error, hasMetaMask, connect, switchNetwork } = wallet
  const [copied, setCopied] = useState(false)
  const copyAddress = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  const title: Record<WalletState, string> = {
    disconnected: 'Connect MetaMask',
    connecting: 'Waiting for MetaMask',
    connected: 'Wallet connected',
    rejected: 'Connection not completed',
    'wrong-network': 'Network check required',
  }
  const detail: Record<WalletState, string> = {
    disconnected: error || 'Connect your wallet to choose Save or Borrow and view your account.',
    connecting: 'Please check your MetaMask popup extension window and approve the connection request to gain full access to Loanch.',
    connected: 'Your wallet is successfully connected. You can use this single account to save funds, request loans, and inspect pool activity.',
    rejected: error || 'The connection request was cancelled or rejected in MetaMask. You can click the button to try connecting again.',
    'wrong-network': error || 'Your wallet is currently on an unsupported network. Please switch to the configured BOT Chain network to proceed.',
  }

  return <section className={`la-wallet-panel la-wallet-panel--${status} ${compact ? 'la-wallet-panel--compact' : ''}`} aria-label="Wallet and network status" aria-busy={status === 'connecting'}>
    <div className="la-wallet-symbol" aria-hidden="true"><Wallet size={23} strokeWidth={1.7} /></div>
    <div className="la-wallet-copy">
      <h2>{title[status]}</h2><p aria-live="polite">{detail[status]}</p>
      {address && <p className="la-wallet-meta">Address: <code title={address}>{shortAddress(address)}</code> <button className="la-copy-button" type="button" onClick={() => void copyAddress()} aria-label={copied ? 'Wallet address copied' : 'Copy full wallet address'} title={copied ? 'Copied' : 'Copy address'}><Copy size={14} aria-hidden="true" /></button><span className="la-sr-only" aria-live="polite">{copied ? 'Wallet address copied.' : `Full wallet address: ${address}`}</span></p>}
      {chainId !== null && <p className="la-wallet-meta">Current chain ID: {chainId.toString()}</p>}
    </div>
    <div className="la-wallet-actions">
      {status === 'wrong-network' && expectedChainId !== null && hasMetaMask
        ? <button className="la-button la-button--primary" type="button" onClick={switchNetwork}>Switch to BOT Chain<ArrowRight size={17} aria-hidden="true" /></button>
        : status === 'connected'
      ? <Badge variant="secondary" className="la-connected-badge"><Check size={17} aria-hidden="true" /> Ready</Badge>
          : hasMetaMask
            ? <button className="la-button la-button--primary" type="button" onClick={connect} disabled={status === 'connecting'} aria-busy={status === 'connecting'}>{status === 'connecting' ? 'Awaiting MetaMask…' : 'Connect to MetaMask'}<ArrowRight size={17} aria-hidden="true" /></button>
            : <a className="la-button la-button--primary" href="https://metamask.io/download/" target="_blank" rel="noreferrer">Install MetaMask<ExternalLink size={17} aria-hidden="true" /></a>}
    </div>
  </section>
}

function EntryPage({ wallet, navigate }: { wallet: Wallet; navigate: (href: string) => void }) {
  const ready = wallet.status === 'connected'

  // Directly render connect page if wallet is not connected without showing loading screen

  if (!ready) return (
    <div className="la-entry la-entry--connect" aria-label="Connect your wallet to continue">
      <div className="la-connect-hero">
        <div className="la-connect-badge" aria-hidden="true">
          <img src="/primary.svg" alt="Loanch logo" width={32} height={30} />
        </div>
        <h1 className="la-connect-title">Connect to Loanch</h1>
        <p className="la-connect-subtitle">Connect your MetaMask wallet and verify the BOT Chain network to start saving or borrowing.</p>
        <div className="la-connect-panel">
          <WalletPanel wallet={wallet} />
          <p className="la-help-text"><ShieldCheck size={16} aria-hidden="true" />After connecting, the same wallet can save, borrow, or inspect pool records.</p>
        </div>
      </div>
      <div className="la-connect-preview" aria-hidden="true">
        <p className="la-connect-preview-label">Available after connecting</p>
        <div className="la-connect-preview-grid">
          {[
            { icon: <PiggyBank size={22} strokeWidth={1.8} />, title: 'Save', desc: 'Deposit funds and earn returns.' },
            { icon: <Landmark size={22} strokeWidth={1.8} />, title: 'Borrow', desc: 'Request a loan from the pool.' },
            { icon: <Receipt size={22} strokeWidth={1.8} />, title: 'Activity', desc: 'View your transaction history.' },
            { icon: <FileText size={22} strokeWidth={1.8} />, title: 'Transparency', desc: 'Inspect verified pool figures.' },
          ].map(item => (
            <div className="la-connect-preview-card" key={item.title}>
              <span className="la-connect-preview-icon">{item.icon}</span>
              <div>
                <strong>{item.title}</strong>
                <span>{item.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  return <div className="la-entry la-entry--actions">
    <PageHeader title="What would you like to do?" description="Choose an action for today. One wallet can save, borrow, or inspect pool records." />
    <div className="la-entry-surface">
      <WalletPanel wallet={wallet} />
      <div className="la-choice-grid" aria-label="Choose a financial action">
        <ActionCard title="Save" description="Deposit funds into the loan pool and earn your share of returns." action="Deposit funds" href="/app/save" navigate={navigate} enabled={ready} icon={<PiggyBank size={24} strokeWidth={1.8} />} />
        <ActionCard title="Borrow" description="Request a loan based on your eligibility and available liquidity." action="Request a loan" href="/app/borrow" navigate={navigate} enabled={ready} icon={<Landmark size={24} strokeWidth={1.8} />} />
        <ActionCard title="Activity" description="View recent pool transactions and block event receipts from your account." action="View activity" href="/app/activity" navigate={navigate} enabled={ready} icon={<Receipt size={24} strokeWidth={1.8} />} />
        <ActionCard title="Transparency" description="Inspect verified pool figures, liquid reserves, and contract references." action="View transparency" href="/app/transparency" navigate={navigate} enabled={ready} icon={<FileText size={24} strokeWidth={1.8} />} />
      </div>
    </div>
  </div>
}

function SpotlightCard({ children, className = '', spotlightColor = 'rgba(49, 208, 163, 0.22)' }: { children: ReactNode; className?: string; spotlightColor?: string }) {
  const divRef = useRef<HTMLDivElement>(null)

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!divRef.current) return
    const rect = divRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    divRef.current.style.setProperty('--mouse-x', `${x}px`)
    divRef.current.style.setProperty('--mouse-y', `${y}px`)
    divRef.current.style.setProperty('--spotlight-color', spotlightColor)
  }

  return (
    <div ref={divRef} onMouseMove={handleMouseMove} className={`card-spotlight ${className}`}>
      {children}
    </div>
  )
}

function ActionCard({ title, description, action, href, navigate, enabled, icon }: {
  title: string; description: string; action: string; href: string
  navigate: (href: string) => void; enabled: boolean; icon: ReactNode
}) {
  const cardType = title.toLowerCase()
  const spotlightColor =
    cardType === 'save' ? 'rgba(49, 208, 163, 0.35)'
    : cardType === 'borrow' ? 'rgba(59, 130, 246, 0.35)'
    : cardType === 'activity' ? 'rgba(56, 189, 248, 0.35)'
    : 'rgba(15, 167, 143, 0.35)'

  const card = (
    <SpotlightCard spotlightColor={spotlightColor} className={`la-choice-spotlight-wrapper la-choice-spotlight--${cardType}`}>
      <Card className={`la-choice la-choice--${cardType}`}>
        <CardHeader className="la-choice-header">
          <span className="la-choice-icon" aria-hidden="true">{icon}</span>
          <div className="la-choice-body">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="la-choice-content"><Separator className="la-choice-separator" decorative /></CardContent>
        <CardFooter className="la-choice-footer">
          <Button asChild variant="ghost" size="lg" className="la-choice-action" tabIndex={-1}>
            <span>{action}<ArrowRight data-icon="inline-end" aria-hidden="true" /></span>
          </Button>
        </CardFooter>
      </Card>
    </SpotlightCard>
  )

  return enabled
    ? <AppLink href={href} navigate={navigate} className="la-choice-link">{card}</AppLink>
    : <div className="la-choice-disabled" aria-disabled="true">{card}</div>
}

function AccessNote({ wallet }: { wallet: Wallet }) {
  return wallet.status === 'connected' ? null : <WalletPanel wallet={wallet} compact />
}

function PoolActionButton({ kind, wallet, pool }: { kind: 'claim'; wallet: Wallet; pool: Pool }) {
  const inFlight = useRef(false)
  const [progress, setProgress] = useState<TxProgress>({ stage: 'idle', label: '' })
  const [failure, setFailure] = useState('')
  const busy = progress.stage === 'awaiting-wallet' || progress.stage === 'submitted' || progress.stage === 'confirming'
  const run = async () => {
    if (!pool.data || wallet.status !== 'connected' || inFlight.current) return
    inFlight.current = true
    setFailure('')
    try {
      await submitAction({ kind }, wallet.address, pool.data, setProgress)
      pool.refresh()
    } catch (cause) {
      setProgress(previous => ({ ...previous, stage: 'failed' }))
      setFailure(actionError(cause))
    } finally { inFlight.current = false }
  }
  return <div className="la-action-result">
    <button className="la-button la-button--primary" type="button" disabled={busy || progress.stage === 'confirmed'} onClick={() => void run()}>Claim return</button>
    {progress.stage !== 'idle' && <p role="status">{progress.label}</p>}
    {progress.hash && <a href={'/app/transactions/' + progress.hash}>View transaction {shortAddress(progress.hash)}</a>}
    {failure && <p role="alert">{failure}</p>}
    {progress.stage !== 'idle' && <TransactionStatusTracker stage={progress.stage} />}
  </div>
}

function SaveDashboard({ wallet, pool, navigate }: { wallet: Wallet; pool: Pool; navigate: (href: string) => void }) {
  const data = pool.data
  return <>
    <PageHeader title="Save" description="Your deposit position and the actions available for the shared pool." />
    <AccessNote wallet={wallet} />
    <PoolNotice pool={pool} />
    <div className="la-dashboard-grid">
      <SpotlightCard spotlightColor="rgba(49, 208, 163, 0.28)" className="la-feature-panel-spotlight">
        <div className="la-feature-panel la-feature-panel--save">
          <h2>Your savings</h2><p>Amounts are read from the configured pool contract.</p>
          <div className="la-figure">{data?.saver ? amountText(data.saver.principalClaim, data) : '—'}</div>
          <DataLine label="Principal claim" value={amountText(data?.saver?.principalClaim, data)} />
          <DataLine label="Claimable return" value={amountText(data?.saver?.claimableReturn, data)} />
          <DataLine label="Withdrawable now" value={amountText(data?.withdrawable, data)} />
          <DataLine label="Wallet balance" value={amountText(data?.walletBalance, data)} />
          {data?.saver && data.saver.claimableReturn > 0n && <PoolActionButton kind="claim" wallet={wallet} pool={pool} />}
        </div>
      </SpotlightCard>
      <SpotlightCard spotlightColor="rgba(15, 167, 143, 0.25)" className="la-side-panel-spotlight">
        <div className="la-side-panel la-side-panel--save">
          <h2>Next action</h2><p>Review the amount and confirm the pool transaction in MetaMask.</p>
          <div className="la-stack-actions">
            <ActionLink href="/app/save/deposit" navigate={navigate}>Prepare deposit</ActionLink>
            <ActionLink href="/app/save/withdraw" navigate={navigate} secondary>Prepare withdrawal</ActionLink>
          </div>
        </div>
      </SpotlightCard>
    </div>
    <Section title="Pool context" description="Values read from the configured pool contract.">
      <div className="la-metric-grid">
        <SpotlightCard spotlightColor="rgba(49, 208, 163, 0.22)" className="la-metric-spotlight">
          <Metric label="Pool liquidity" value={amountText(data?.stats.liquidPoolAssets, data)} />
        </SpotlightCard>
        <SpotlightCard spotlightColor="rgba(49, 208, 163, 0.22)" className="la-metric-spotlight">
          <Metric label="Your pool share" value={data?.saver && data.stats.totalShares > 0n ? `${(Number(data.saver.shares * 10000n / data.stats.totalShares) / 100).toFixed(2)}%` : 'Unavailable'} />
        </SpotlightCard>
        <SpotlightCard spotlightColor="rgba(49, 208, 163, 0.22)" className="la-metric-spotlight">
          <Metric label="Saver weight" value={data?.saver ? `${Number(data.saver.weightBps || 10000n) / 10000}×` : 'Unavailable'} />
        </SpotlightCard>
      </div>
    </Section>
  </>
}

function BorrowDashboard({ wallet, pool, navigate }: { wallet: Wallet; pool: Pool; navigate: (href: string) => void }) {
  const data = pool.data
  const loan = data?.activeLoan
  return <>
    <PageHeader title="Borrow" description="Check your loan status, then prepare a request or repayment.">
      <ActionLink href="/app/borrow/request" navigate={navigate}>Request a loan</ActionLink>
      <ActionLink href="/app/borrow/repay" navigate={navigate} secondary>Repay a loan</ActionLink>
      <ActionLink href="/app/borrow/stake" navigate={navigate} secondary>Manage stake</ActionLink>
    </PageHeader>
    <AccessNote wallet={wallet} />
    <PoolNotice pool={pool} />
    <div className="la-dashboard-grid">
      <SpotlightCard spotlightColor="rgba(59, 130, 246, 0.28)" className="la-feature-panel-spotlight">
        <div className="la-feature-panel la-feature-panel--borrow">
          <h2>Your borrowing</h2><p>Active position read from the pool contract.</p>
          <div className="la-figure">{data ? amountText(loan ? loan.totalRepayment - loan.amountPaid : 0n, data) : '—'}</div>
          <DataLine label="Active loan" value={loan ? `#${loan.id}` : data ? 'None' : 'Unavailable'} />
          <DataLine label="Amount repaid" value={amountText(loan?.amountPaid ?? (data ? 0n : null), data)} />
          <DataLine label="Allocated stake" value={amountText(data?.allocatedStake, data)} />
          <DataLine label="Free stake" value={amountText(data?.freeStake, data)} />
        </div>
      </SpotlightCard>
      <SpotlightCard spotlightColor="rgba(59, 130, 246, 0.22)" className="la-side-panel-spotlight">
        <div className="la-side-panel la-side-panel--borrow">
          <h2>Before you request</h2>
          <p>Risk, reputation, free stake, loan limit, and liquidity are checked on-chain before a request.</p>
          <div className="la-stack-actions">
            <ActionLink href="/app/borrow/request" navigate={navigate}>Review requirements</ActionLink>
          </div>
        </div>
      </SpotlightCard>
    </div>
    <Section title="Borrower position">
      <SpotlightCard spotlightColor="rgba(59, 130, 246, 0.22)" className="la-panel-spotlight">
        <div className="la-panel la-panel--borrow">
          <DataLine label="Risk score" value={data?.borrower?.riskScore.toString() ?? 'Unavailable'} />
          <DataLine label="Reputation" value={data?.borrower?.reputation.toString() ?? 'Unavailable'} />
          {loan && <ActionLink href={`/app/borrow/loan/${loan.id}`} navigate={navigate}>View active loan</ActionLink>}
        </div>
      </SpotlightCard>
    </Section>
  </>
}

const formContent: Record<FormKind, { title: string; description: string; label: string; preview: string }> = {
  deposit: {
    title: 'Deposit funds', description: 'Deposit the pool asset into the shared loan pool.',
    label: 'Deposit amount', preview: 'Amount to deposit',
  },
  withdraw: {
    title: 'Withdraw', description: 'Withdraw available Saver principal.',
    label: 'Withdrawal amount', preview: 'Amount to withdraw',
  },
  request: {
    title: 'Request a loan', description: 'Check eligibility before signing a loan request.',
    label: 'Requested amount', preview: 'Requested principal',
  },
  repay: {
    title: 'Repay a loan', description: 'Repay your active loan using the pool asset.',
    label: 'Repayment amount', preview: 'Amount to repay',
  },
  stake: { title: 'Stake', description: 'Lock the pool asset as free borrower stake.', label: 'Stake amount', preview: 'Amount to stake' },
  unstake: { title: 'Unstake', description: 'Withdraw free stake that is not allocated to a loan.', label: 'Unstake amount', preview: 'Amount to unstake' },
}

function FinancialForm({ kind, wallet, pool, navigate }: { kind: FormKind; wallet: Wallet; pool: Pool; navigate: (href: string) => void }) {
  const inFlight = useRef(false)
  const [amount, setAmount] = useState('')
  const [days, setDays] = useState('30')
  const [reviewing, setReviewing] = useState(false)
  const [previewState, setPreviewState] = useState<{ key: string; result?: { reason: bigint; stakeRequired: bigint }; error?: string } | null>(null)
  const [progress, setProgress] = useState<TxProgress>({ stage: 'idle', label: '' })
  const [failure, setFailure] = useState('')
  const details = formContent[kind]
  const data = pool.data
  const backHref = kind === 'deposit' || kind === 'withdraw' ? '/app/save' : '/app/borrow'
  let parsedAmount: bigint | null = null
  let amountError = ''
  try { if (data && amount) parsedAmount = parseAmount(amount, data) } catch (cause) { amountError = cause instanceof Error ? cause.message : 'Invalid amount.' }
  const duration = Number(days)
  const durationValid = Number.isInteger(duration) && duration >= 1 && duration <= 365
  const previewKey = wallet.address + ':' + amount + ':' + days
  const preview = previewState?.key === previewKey ? previewState.result : null
  const previewError = previewState?.key === previewKey ? previewState.error : ''
  const busy = progress.stage === 'awaiting-wallet' || progress.stage === 'submitted' || progress.stage === 'confirming'
  const limit = kind === 'withdraw' ? data?.withdrawable
    : kind === 'unstake' ? data?.freeStake
      : kind === 'repay' && data?.activeLoan ? (data.walletBalance < data.activeLoan.totalRepayment - data.activeLoan.amountPaid ? data.walletBalance : data.activeLoan.totalRepayment - data.activeLoan.amountPaid)
        : kind === 'deposit' || kind === 'stake' || kind === 'repay' ? data?.walletBalance : null
  const overLimit = parsedAmount !== null && limit !== null && limit !== undefined && parsedAmount > limit
  const requestBlocked = kind === 'request' && (!durationValid || preview?.reason !== 0n)
  const canReview = wallet.status === 'connected' && Boolean(data && parsedAmount && !overLimit && (kind !== 'request' || durationValid) && (kind !== 'repay' || data?.activeLoan))
  const canConfirm = canReview && !requestBlocked && !busy && progress.stage !== 'confirmed'

  useEffect(() => {
    if (kind !== 'request' || !reviewing || !parsedAmount || !durationValid || !wallet.address) return
    let current = true
    void previewLoan(wallet.address, parsedAmount, duration).then(result => {
      if (current) setPreviewState({ key: previewKey, result })
    }).catch(cause => {
      if (current) setPreviewState({ key: previewKey, error: cause instanceof Error ? cause.message : 'Could not check loan eligibility.' })
    })
    return () => { current = false }
  }, [kind, reviewing, parsedAmount, duration, durationValid, wallet.address, previewKey])

  const submit = async () => {
    if (!data || !parsedAmount || !canConfirm || inFlight.current) return
    inFlight.current = true
    setFailure('')
    try {
      await submitAction({ kind, amount: parsedAmount, durationDays: duration, loanId: data.activeLoan?.id }, wallet.address, data, setProgress)
      pool.refresh()
    } catch (cause) {
      setProgress(previous => ({ ...previous, stage: 'failed' }))
      setFailure(actionError(cause))
    } finally { inFlight.current = false }
  }

  return <>
    <PageHeader title={details.title} description={details.description}>
      <ActionLink href={backHref} navigate={navigate} secondary>Back to {kind === 'deposit' || kind === 'withdraw' ? 'Save' : 'Borrow'}</ActionLink>
    </PageHeader>
    <AccessNote wallet={wallet} />
    <PoolNotice pool={pool} />
    <div className="la-flow-grid">
      <SpotlightCard spotlightColor="rgba(49, 208, 163, 0.22)" className="la-form-panel-spotlight">
        <div className="la-form-panel">
          <h2>{reviewing ? 'Review details' : 'Enter amount'}</h2>
          {!reviewing ? <>
            <label className="la-field" htmlFor="loanch-amount"><span>{details.label}</span><span className="la-input-wrap"><input
              id="loanch-amount" type="text" inputMode="decimal" autoComplete="off" value={amount}
              onChange={event => setAmount(event.target.value)} placeholder="0.00"
              disabled={!data || wallet.status !== 'connected'} aria-describedby="loanch-amount-hint"
              aria-invalid={Boolean(amount && amountError)}
            /><span>{data?.assetSymbol ?? 'asset'}</span></span></label>
            <p className="la-field-hint" id="loanch-amount-hint">Pool asset: {data?.assetSymbol ?? 'loading'} · {data?.decimals ?? '—'} decimals.</p>
            {amountError && <p className="la-field-error" role="alert">{amountError}</p>}
            {overLimit && <p className="la-field-error" role="alert">Amount exceeds the available limit.</p>}
            {kind === 'request' && <label className="la-field" htmlFor="loanch-duration"><span>Duration in days</span><span className="la-input-wrap"><input id="loanch-duration" type="number" min="1" max="365" step="1" value={days} onChange={event => setDays(event.target.value)} /></span></label>}
            {kind === 'request' && !durationValid && <p className="la-field-error" role="alert">Duration must be 1–365 days.</p>}
            {kind === 'repay' && data && !data.activeLoan && <p className="la-field-error" role="alert">There is no active loan to repay.</p>}
            <button className="la-button la-button--primary" type="button" disabled={!canReview} onClick={() => setReviewing(true)}>Review {kind}<ArrowRight size={17} aria-hidden="true" /></button>
          </> : <>
            <div className="la-review">
              <DataLine label={details.preview} value={parsedAmount !== null ? amountText(parsedAmount, data) : 'Unavailable'} />
              <DataLine label="From wallet" value={wallet.address ? shortAddress(wallet.address) : 'Unavailable'} />
              <DataLine label="Pool contract" value={LOANCH_CONTRACT_ADDRESS || 'Unavailable'} />
              <DataLine label="Network" value={expectedChainId?.toString() ?? 'Not configured'} />
              {kind === 'request' && <DataLine label="Duration" value={days + ' days'} />}
              {kind === 'request' && <DataLine label="Required stake" value={amountText(preview?.stakeRequired, data)} />}
              {kind === 'request' && <DataLine label="Eligibility" value={preview ? eligibilityText(preview.reason) : previewError || 'Checking…'} />}
              {kind === 'repay' && <DataLine label="Loan ID" value={data?.activeLoan?.id.toString() ?? 'No active loan'} />}
            </div>
            {requestBlocked && preview?.reason !== undefined && <Notice tone="warning">{eligibilityText(preview.reason)}. Resolve this before requesting.</Notice>}
            {failure && <Notice tone="warning">{failure}</Notice>}
            {progress.stage === 'confirmed' && <Notice tone="success">Confirmed on-chain. Account data is refreshing.</Notice>}
            {progress.hash && <ActionLink href={'/app/transactions/' + progress.hash} navigate={navigate} secondary>View transaction</ActionLink>}
            <div className="la-inline-actions"><button className="la-button la-button--secondary" type="button" disabled={busy} onClick={() => setReviewing(false)}>Edit amount</button><button className="la-button la-button--primary" type="button" disabled={!canConfirm} onClick={() => void submit()}>{busy ? 'Waiting…' : 'Confirm ' + kind}</button></div>
          </>}
        </div>
      </SpotlightCard>
      <SpotlightCard spotlightColor="rgba(15, 167, 143, 0.2)" className="la-flow-aside-spotlight">
        <div className="la-flow-aside">
          <div className="la-requirements">
            <h2>Live limits</h2>
            <DataLine label="Wallet balance" value={amountText(data?.walletBalance, data)} />
            {kind === 'withdraw' && <DataLine label="Withdrawable" value={amountText(data?.withdrawable, data)} />}
            {(kind === 'stake' || kind === 'unstake' || kind === 'request') && <DataLine label="Free stake" value={amountText(data?.freeStake, data)} />}
            {kind === 'repay' && <DataLine label="Remaining debt" value={amountText(data?.activeLoan ? data.activeLoan.totalRepayment - data.activeLoan.amountPaid : null, data)} />}
            {kind === 'request' && <DataLine label="Available lending" value={amountText(data?.stats.availableLending, data)} />}
          </div>
          {kind === 'stake' && <ActionLink href="/app/borrow/unstake" navigate={navigate} secondary>Unstake free funds</ActionLink>}
          {progress.stage !== 'idle' && <p role="status">{progress.label}</p>}
          <TransactionStatusTracker stage={progress.stage} />
        </div>
      </SpotlightCard>
    </div>
  </>
}

function LoanDetail({ id, wallet, pool, navigate }: { id: string; wallet: Wallet; pool: Pool; navigate: (href: string) => void }) {
  const [loan, setLoan] = useState<Loan | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    if (!/^[1-9]\d*$/.test(id)) return
    void readLoan(BigInt(id)).then(value => { if (current) setLoan(value) })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'Could not read this loan.') })
    return () => { current = false }
  }, [id, pool.data])
  return <>
    <PageHeader title="Loan detail" description="Loan information read from the pool contract.">
      <ActionLink href="/app/borrow" navigate={navigate} secondary>Back to Borrow</ActionLink>
    </PageHeader>
    <AccessNote wallet={wallet} />
    <Section title="Loan record">
      <DataLine label="Requested loan ID" value={id} />
      {error && <Notice tone="warning">{error}</Notice>}
      {!loan && !error && <Notice>{/^[1-9]\d*$/.test(id) ? 'Loading loan record…' : 'Invalid loan ID.'}</Notice>}
      {loan && <SpotlightCard spotlightColor="rgba(59, 130, 246, 0.22)" className="la-panel-spotlight">
        <div className="la-panel la-panel--borrow">
          <DataLine label="Borrower" value={loan.borrower} />
          <DataLine label="Status" value={['None', 'Active', 'Completed', 'Defaulted'][Number(loan.status)] ?? 'Unknown'} />
          <DataLine label="Principal" value={amountText(loan.principal, pool.data)} />
          <DataLine label="Remaining debt" value={amountText(loan.totalRepayment - loan.amountPaid, pool.data)} />
          <DataLine label="Amount paid" value={amountText(loan.amountPaid, pool.data)} />
          <DataLine label="Due date" value={new Date(Number(loan.dueDate) * 1000).toLocaleString()} />
          <DataLine label="Locked stake" value={amountText(loan.stakeAmount, pool.data)} />
        </div>
      </SpotlightCard>}
    </Section>
  </>
}

function ActivityPage({ wallet, navigate }: { wallet: Wallet; navigate: (href: string) => void }) {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (wallet.status !== 'connected' || !wallet.address) return
    let current = true
    void Promise.resolve().then(async () => {
      setLoading(true)
      try { const activity = await readActivity(wallet.address); if (current) setItems(activity) }
      catch (cause) { if (current) setError(cause instanceof Error ? cause.message : 'Could not read activity.') }
      finally { if (current) setLoading(false) }
    })
    return () => { current = false }
  }, [wallet.address, wallet.status])
  return <>
    <PageHeader title="Activity" description="Recent pool transactions sent by your connected wallet." />
    <Section title="Recent transactions" description="Showing pool events from up to 5,000 recent blocks and 200 recent logs.">
      {wallet.status !== 'connected' ? <EmptyState title="Connect your wallet" description="Connect MetaMask to see transactions sent by your account." />
        : error ? <Notice tone="warning">{error}</Notice>
          : loading ? <Notice>Reading recent on-chain activity…</Notice>
            : items.length ? (
              <div className="la-activity-grid">
                {items.map(item => {
                  const actionType = item.action.toLowerCase()
                  const isDeposit = actionType.includes('deposit') || actionType.includes('save')
                  const isBorrow = actionType.includes('borrow') || actionType.includes('loan')
                  const isRepay = actionType.includes('repay') || actionType.includes('pay')

                  return (
                    <SpotlightCard key={item.hash} spotlightColor={isDeposit ? 'rgba(49, 208, 163, 0.25)' : isBorrow ? 'rgba(59, 130, 246, 0.25)' : 'rgba(15, 167, 143, 0.25)'} className="la-activity-spotlight-wrapper">
                      <div className="la-activity-card">
                        <div className="la-activity-card-header">
                          <div className="la-activity-badge-group">
                            <span className={`la-activity-type-badge la-activity-type-badge--${isDeposit ? 'deposit' : isBorrow ? 'borrow' : isRepay ? 'repay' : 'default'}`}>
                              {item.action}
                            </span>
                            <span className="la-activity-block-badge">
                              Block #{item.block}
                            </span>
                          </div>
                          <ActionLink href={'/app/transactions/' + item.hash} navigate={navigate} secondary>
                            Details <ArrowRight size={14} aria-hidden="true" />
                          </ActionLink>
                        </div>
                        <div className="la-activity-card-body">
                          <div className="la-activity-hash-row">
                            <span className="la-activity-hash-label">Transaction Hash</span>
                            <code className="la-activity-hash-code" title={item.hash}>{item.hash}</code>
                          </div>
                        </div>
                      </div>
                    </SpotlightCard>
                  )
                })}
              </div>
            )
              : <EmptyState title="No recent pool transactions" description="No transactions from this wallet appeared in the scanned block range." />}
    </Section>
  </>
}

function TransactionDetail({ hash, navigate }: { hash: string; navigate: (href: string) => void }) {
  const validHash = /^0x[0-9a-fA-F]{64}$/.test(hash)
  const [record, setRecord] = useState<Awaited<ReturnType<typeof readTransaction>>>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!validHash) return
    let current = true
    void readTransaction(hash).then(value => { if (current) setRecord(value) })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'Could not verify the transaction.') })
    return () => { current = false }
  }, [hash, validHash])
  return <>
    <PageHeader title="Transaction detail" description="Receipt verified against the configured RPC.">
      <ActionLink href="/app/activity" navigate={navigate} secondary>Back to Activity</ActionLink>
    </PageHeader>
    <Section title="Transaction reference">
      <DataLine label="Hash from URL" value={validHash ? hash : 'Invalid hash'} />
      {!validHash && <Notice tone="warning">A transaction hash must contain 0x followed by 64 hexadecimal characters.</Notice>}
      {error && <Notice tone="warning">{error}</Notice>}
      {validHash && !record && !error && <Notice>Waiting for a transaction receipt…</Notice>}
      {record && (
        <SpotlightCard spotlightColor="rgba(49, 208, 163, 0.2)" className="la-detail-spotlight-wrapper">
          <div className="la-detail-card">
            <div className="la-detail-card-header">
              <h3>Receipt Summary</h3>
              <span className={`la-status-tag la-status-tag--${record.confirmed ? 'success' : 'failed'}`}>
                {record.confirmed ? 'Confirmed' : 'Failed'}
              </span>
            </div>
            <div className="la-detail-card-grid">
              <div className="la-detail-item">
                <span className="la-detail-label">Action</span>
                <strong className="la-detail-value">{record.action}</strong>
              </div>
              <div className="la-detail-item">
                <span className="la-detail-label">Block Number</span>
                <strong className="la-detail-value">#{record.block.toString()}</strong>
              </div>
              <div className="la-detail-item la-detail-item--full">
                <span className="la-detail-label">From Address</span>
                <code className="la-detail-code">{record.from}</code>
              </div>
              <div className="la-detail-item la-detail-item--full">
                <span className="la-detail-label">To Address</span>
                <code className="la-detail-code">{record.to}</code>
              </div>
              <div className="la-detail-item">
                <span className="la-detail-label">Pool Contract Transaction</span>
                <strong className="la-detail-value">{record.pool ? 'Verified Pool Contract' : 'External Address'}</strong>
              </div>
            </div>
          </div>
        </SpotlightCard>
      )}
    </Section>
  </>
}

function TransparencyPage({ pool }: { pool: Pool }) {
  const contractAddress = LOANCH_CONTRACT_ADDRESS?.trim() || ''
  const data = pool.data
  const [copied, setCopied] = useState(false)
  const copyAddress = async () => {
    if (!contractAddress) return
    try {
      await navigator.clipboard.writeText(contractAddress)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return <>
    <PageHeader title="Transparency" description="Pool figures and contract references, presented only when they can be verified." />
    <PoolNotice pool={pool} />
    <Section title="Pool overview" description="Live values read from the configured pool contract.">
      <div className="la-metric-grid la-metric-grid--four">
        <Metric label="Liquid pool assets" value={amountText(data?.stats.liquidPoolAssets, data)} />
        <Metric label="Saver principal claims" value={amountText(data?.stats.saverPrincipalClaims, data)} />
        <Metric label="Active loan principal" value={amountText(data?.stats.activeLoanPrincipal, data)} />
        <Metric label="Loss reserve" value={amountText(data?.stats.lossReserveAmount, data)} />
      </div>
    </Section>
    <Section title="Verification">
      <div className="la-verification-grid">
        <div className="la-panel"><h3>Network configuration</h3><DataLine label="Expected chain ID" value={botChainConfig.chainId || 'Not configured'} /><DataLine label="RPC URL" value={botChainConfig.rpcUrl ? 'Configured' : 'Not configured'} /><p>Configuration indicates a target network; it does not prove that contract data has been verified.</p></div>
        <div className="la-panel"><h3>Contract reference</h3>
          <p className="la-contract-address">{contractAddress || 'Not configured'}</p>
          {contractAddress && <button className="la-button la-button--secondary" type="button" onClick={copyAddress}>{copied ? 'Copied' : 'Copy address'}<Copy size={16} aria-hidden="true" /></button>}
          <p>{data ? 'Pool contract and native BOT balance were verified on the configured RPC.' : 'Pool contract verification is pending.'}</p>
        </div>
      </div>
    </Section>
  </>
}

function SettingsPage({ wallet, pool }: { wallet: Wallet; pool: Pool }) {
  return <>
    <PageHeader title="Settings" description="Review wallet and network context for this session." />
    <WalletPanel wallet={wallet} />
    <Section title="Connection details">
      <div className="la-panel">
        <DataLine label="Wallet" value={wallet.address || 'Not connected'} />
        <DataLine label="Current chain ID" value={wallet.chainId?.toString() ?? 'Unavailable'} />
        <DataLine label="Expected chain ID" value={expectedChainId?.toString() ?? 'Not configured'} />
        <DataLine label="Pool contract" value={pool.data ? 'Verified on configured RPC' : pool.error || 'Checking…'} />
        <DataLine label="Contract write actions" value={pool.data && wallet.status === 'connected' ? 'Available after review' : 'Unavailable'} />
      </div>
    </Section>
  </>
}

function NotFoundPage({ navigate }: { navigate: (href: string) => void }) {
  return <><PageHeader title="Page not found" description="This app route does not exist." /><ActionLink href="/app" navigate={navigate}>Go to App Entry</ActionLink></>
}

function AppContent({ path, wallet, pool, navigate }: { path: string; wallet: Wallet; pool: Pool; navigate: (href: string) => void }) {
  const getPage = () => {
    if (path === '/app' || path === '/app/') return <EntryPage wallet={wallet} navigate={navigate} />
    if ((/^\/app\/save(?:\/|$)/.test(path) || /^\/app\/borrow(?:\/|$)/.test(path)) && wallet.status !== 'connected') return <>
      <PageHeader title="Connect to continue" description="Connect MetaMask and verify the BOT Chain network before choosing a financial action." />
      <WalletPanel wallet={wallet} />
      <div className="la-gate-return"><ActionLink href="/app" navigate={navigate} secondary>Back to App Entry</ActionLink></div>
    </>
    if (path === '/app/save') return <SaveDashboard wallet={wallet} pool={pool} navigate={navigate} />
    if (path === '/app/save/deposit') return <FinancialForm kind="deposit" wallet={wallet} pool={pool} navigate={navigate} />
    if (path === '/app/save/withdraw') return <FinancialForm kind="withdraw" wallet={wallet} pool={pool} navigate={navigate} />
    if (path === '/app/borrow') return <BorrowDashboard wallet={wallet} pool={pool} navigate={navigate} />
    if (path === '/app/borrow/request') return <FinancialForm kind="request" wallet={wallet} pool={pool} navigate={navigate} />
    if (path === '/app/borrow/repay') return <FinancialForm kind="repay" wallet={wallet} pool={pool} navigate={navigate} />
    if (path === '/app/borrow/stake') return <FinancialForm kind="stake" wallet={wallet} pool={pool} navigate={navigate} />
    if (path === '/app/borrow/unstake') return <FinancialForm kind="unstake" wallet={wallet} pool={pool} navigate={navigate} />
    if (/^\/app\/borrow\/loan\/[^/]+$/.test(path)) return <LoanDetail key={path} id={path.slice('/app/borrow/loan/'.length)} wallet={wallet} pool={pool} navigate={navigate} />
    if (path === '/app/activity') return <ActivityPage wallet={wallet} navigate={navigate} />
    if (/^\/app\/transactions\/[^/]+$/.test(path)) return <TransactionDetail key={path} hash={path.slice('/app/transactions/'.length)} navigate={navigate} />
    if (path === '/app/transparency') return <TransparencyPage pool={pool} />
    if (path === '/app/settings') return <SettingsPage wallet={wallet} pool={pool} />
    return <NotFoundPage navigate={navigate} />
  }

  return (
    <div key={path} className="la-page-view">
      {getPage()}
    </div>
  )
}

function AppExperience() {
  const wallet = useWallet()
  const pool = usePool(wallet.address, wallet.status === 'connected')
  const { path, navigate } = useAppPath()
  const [mobileOpen, setMobileOpen] = useState(false)
  const navigateAndClose = (href: string) => {
    setMobileOpen(false)
    navigate(href)
  }
  useEffect(() => {
    if (!mobileOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileOpen])
  const activeNav = path.startsWith('/app/save') ? '/app/save'
    : path.startsWith('/app/borrow') ? '/app/borrow'
      : path.startsWith('/app/activity') || path.startsWith('/app/transactions/') ? '/app/activity'
        : path.startsWith('/app/transparency') ? '/app/transparency'
          : path.startsWith('/app/settings') ? '/app/settings' : '/app'

  return <div className="loanch-app">
    <a className="la-skip" href="#app-main">Skip to content</a>
    <div className="la-shell">
      <header className="la-mobile-header">
        <button className="la-menu-button" type="button" aria-label={mobileOpen ? 'Close app navigation' : 'Open app navigation'} aria-expanded={mobileOpen} aria-controls="app-navigation" onClick={() => setMobileOpen(open => !open)}>{mobileOpen ? <X size={21} aria-hidden="true" /> : <Menu size={21} aria-hidden="true" />}</button>
        <AppLink href="/app" navigate={navigateAndClose} className="la-mobile-brand" title="Loanch app"><img src="/primary.svg" alt="" width={25} height={24} /><span>loanch<span>.</span></span></AppLink>
        <AppLink href="/app/settings" navigate={navigateAndClose} className="la-mobile-account" title="Wallet settings"><span className={`la-status-dot la-status-dot--${wallet.status}`} aria-hidden="true" /><span className="la-sr-only">Wallet settings. Status: {wallet.status.replace('-', ' ')}.</span><ShieldCheck size={18} aria-hidden="true" /></AppLink>
      </header>
      <aside id="app-navigation" className={`la-sidebar ${mobileOpen ? 'la-sidebar--open' : ''}`} aria-label="App navigation">
        <div className="la-sidebar-header">
          <AppLink href="/app" navigate={navigateAndClose} className="la-logo" title="Loanch app">
            <img src="/primary.svg" alt="Loanch logo" width={32} height={30} className="la-logo-img" />
          </AppLink>
        </div>
        
        <nav className="la-sidebar-nav" aria-label="App pages">
          {nav.map(item => {
            const Icon = item.icon
            const isCurrent = activeNav === item.href
            return (
              <AppLink
                key={item.href}
                href={item.href}
                navigate={navigateAndClose}
                current={isCurrent}
                className={`la-nav-item ${isCurrent ? 'la-nav-item--active' : ''}`}
                title={item.label}
              >
                <div className="la-nav-icon">
                  <Icon size={20} aria-hidden="true" />
                </div>
                <span className="la-nav-tooltip">{item.label}</span>
              </AppLink>
            )
          })}
        </nav>

        <div className="la-sidebar-footer">
          <AppLink
            href="/app/settings"
            navigate={navigateAndClose}
            current={activeNav === '/app/settings'}
            className="la-nav-item la-avatar-item"
            title="Account Settings"
          >
            <div className="la-avatar-wrap">
              <span className={`la-status-dot la-status-dot--${wallet.status}`} aria-hidden="true" />
              <ShieldCheck size={18} className="la-avatar-icon" />
            </div>
            <span className="la-nav-tooltip">{wallet.address ? shortAddress(wallet.address) : 'Wallet'}</span>
          </AppLink>
        </div>
      </aside>
      {mobileOpen && <button className="la-sidebar-backdrop" type="button" onClick={() => setMobileOpen(false)} aria-label="Close app navigation" />}

      <div className="la-main-column">
        <main className="la-main" id="app-main"><AppContent path={path} wallet={wallet} pool={pool} navigate={navigateAndClose} /></main>
      </div>
    </div>
  </div>
}

export default AppExperience

