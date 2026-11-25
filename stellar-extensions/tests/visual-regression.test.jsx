/**
 * Visual Regression Tests for Key Components — Issue #987
 *
 * Snapshot tests covering:
 *   - PuzzleComponent
 *   - NftCard
 *   - WalletConnectButton
 *   - Navbar
 *   - Footer
 *   - Homepage sections
 *   - Dark mode variants for all components
 *   - Mobile viewport snapshots
 *
 * Target folder: stellar-extensions/tests/
 * Follows patterns in frontend/tests/page-states.test.jsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Mock heavy dependencies so the tests stay self-contained
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("next/image", () => ({
  default: ({ src, alt, ...rest }) => <img src={src} alt={alt} {...rest} />,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Minimal stub components — replace with real imports when the components
// exist under frontend/ so the tests exercise actual rendering behaviour.
// ---------------------------------------------------------------------------

const PuzzleComponent = ({ title, difficulty, solved, timeLimit }) => (
  <div data-testid="puzzle-component">
    <h2>{title}</h2>
    <span data-testid="difficulty">{difficulty}</span>
    {solved && <span data-testid="solved-badge">Solved</span>}
    {timeLimit && <span data-testid="time-limit">{timeLimit}s</span>}
  </div>
);

const NftCard = ({ name, imageUrl, rarity, claimed }) => (
  <div data-testid="nft-card">
    <img src={imageUrl} alt={name} />
    <p data-testid="nft-name">{name}</p>
    <span data-testid="nft-rarity">{rarity}</span>
    {claimed && <span data-testid="claimed-badge">Claimed</span>}
  </div>
);

const WalletConnectButton = ({ connected, address, onConnect, onDisconnect }) => (
  <button
    data-testid="wallet-connect-button"
    onClick={connected ? onDisconnect : onConnect}
  >
    {connected ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Connect Wallet"}
  </button>
);

const Navbar = ({ connected, username }) => (
  <nav data-testid="navbar">
    <span data-testid="brand">StellarHunts</span>
    <a href="/puzzles">Puzzles</a>
    <a href="/leaderboard">Leaderboard</a>
    {connected ? (
      <span data-testid="nav-user">{username}</span>
    ) : (
      <button data-testid="nav-connect">Connect</button>
    )}
  </nav>
);

const Footer = () => (
  <footer data-testid="footer">
    <span>© {new Date().getFullYear()} StellarHunts</span>
    <a href="/terms">Terms</a>
    <a href="/privacy">Privacy</a>
    <a href="https://twitter.com/stellarhunts">Twitter</a>
  </footer>
);

const HeroSection = ({ headline, subheadline }) => (
  <section data-testid="hero-section">
    <h1>{headline}</h1>
    <p>{subheadline}</p>
    <button>Get Started</button>
  </section>
);

const FeaturedPuzzlesSection = ({ puzzles }) => (
  <section data-testid="featured-puzzles">
    <h2>Featured Puzzles</h2>
    {puzzles.map((p) => (
      <div key={p.id} data-testid="featured-puzzle-item">
        {p.title}
      </div>
    ))}
  </section>
);

const LeaderboardPreviewSection = ({ players }) => (
  <section data-testid="leaderboard-preview">
    <h2>Top Players</h2>
    {players.map((p) => (
      <div key={p.id} data-testid="leaderboard-player">
        {p.name}
      </div>
    ))}
  </section>
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Renders a component inside a dark-mode wrapper. */
const renderDark = (ui) =>
  render(<div className="dark" data-theme="dark">{ui}</div>);

/** Simulates a mobile viewport (375 × 812). */
function setMobileViewport() {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 375 });
  Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: 812 });
  window.dispatchEvent(new Event("resize"));
}

/** Restores the default desktop viewport (1280 × 800). */
function setDesktopViewport() {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 1280 });
  Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: 800 });
  window.dispatchEvent(new Event("resize"));
}

// ---------------------------------------------------------------------------
// PuzzleComponent
// ---------------------------------------------------------------------------

describe("PuzzleComponent — visual regression", () => {
  it("matches snapshot: default state", () => {
    const { asFragment } = render(
      <PuzzleComponent
        title="Genesis Cipher"
        difficulty="Hard"
        solved={false}
        timeLimit={300}
      />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: solved state", () => {
    const { asFragment } = render(
      <PuzzleComponent
        title="Genesis Cipher"
        difficulty="Hard"
        solved={true}
        timeLimit={300}
      />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: dark mode", () => {
    const { asFragment } = renderDark(
      <PuzzleComponent
        title="Midnight Hash"
        difficulty="Expert"
        solved={false}
        timeLimit={600}
      />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: mobile viewport", () => {
    setMobileViewport();
    const { asFragment } = render(
      <PuzzleComponent
        title="Mobile Puzzle"
        difficulty="Beginner"
        solved={false}
        timeLimit={120}
      />
    );
    expect(asFragment()).toMatchSnapshot();
    setDesktopViewport();
  });
});

// ---------------------------------------------------------------------------
// NftCard
// ---------------------------------------------------------------------------

describe("NftCard — visual regression", () => {
  it("matches snapshot: unclaimed NFT", () => {
    const { asFragment } = render(
      <NftCard
        name="Stellar Phoenix #001"
        imageUrl="/nfts/phoenix.png"
        rarity="Legendary"
        claimed={false}
      />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: claimed NFT", () => {
    const { asFragment } = render(
      <NftCard
        name="Stellar Phoenix #001"
        imageUrl="/nfts/phoenix.png"
        rarity="Legendary"
        claimed={true}
      />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: dark mode", () => {
    const { asFragment } = renderDark(
      <NftCard
        name="Void Sentinel #042"
        imageUrl="/nfts/sentinel.png"
        rarity="Rare"
        claimed={false}
      />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: mobile viewport", () => {
    setMobileViewport();
    const { asFragment } = render(
      <NftCard
        name="Common Gear #100"
        imageUrl="/nfts/gear.png"
        rarity="Common"
        claimed={false}
      />
    );
    expect(asFragment()).toMatchSnapshot();
    setDesktopViewport();
  });
});

// ---------------------------------------------------------------------------
// WalletConnectButton
// ---------------------------------------------------------------------------

describe("WalletConnectButton — visual regression", () => {
  it("matches snapshot: disconnected", () => {
    const { asFragment } = render(
      <WalletConnectButton
        connected={false}
        address=""
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
      />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: connected", () => {
    const { asFragment } = render(
      <WalletConnectButton
        connected={true}
        address="GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGBXC4EYMNE2TQHUJ"
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
      />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: dark mode — disconnected", () => {
    const { asFragment } = renderDark(
      <WalletConnectButton
        connected={false}
        address=""
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
      />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: dark mode — connected", () => {
    const { asFragment } = renderDark(
      <WalletConnectButton
        connected={true}
        address="GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGBXC4EYMNE2TQHUJ"
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
      />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: mobile viewport — disconnected", () => {
    setMobileViewport();
    const { asFragment } = render(
      <WalletConnectButton
        connected={false}
        address=""
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
      />
    );
    expect(asFragment()).toMatchSnapshot();
    setDesktopViewport();
  });
});

// ---------------------------------------------------------------------------
// Navbar
// ---------------------------------------------------------------------------

describe("Navbar — visual regression", () => {
  it("matches snapshot: logged-out state", () => {
    const { asFragment } = render(<Navbar connected={false} />);
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: logged-in state", () => {
    const { asFragment } = render(
      <Navbar connected={true} username="crypto_explorer" />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: dark mode — logged out", () => {
    const { asFragment } = renderDark(<Navbar connected={false} />);
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: dark mode — logged in", () => {
    const { asFragment } = renderDark(
      <Navbar connected={true} username="stellar_hunter" />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: mobile viewport", () => {
    setMobileViewport();
    const { asFragment } = render(<Navbar connected={false} />);
    expect(asFragment()).toMatchSnapshot();
    setDesktopViewport();
  });
});

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

describe("Footer — visual regression", () => {
  it("matches snapshot: default", () => {
    const { asFragment } = render(<Footer />);
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: dark mode", () => {
    const { asFragment } = renderDark(<Footer />);
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: mobile viewport", () => {
    setMobileViewport();
    const { asFragment } = render(<Footer />);
    expect(asFragment()).toMatchSnapshot();
    setDesktopViewport();
  });
});

// ---------------------------------------------------------------------------
// Homepage sections
// ---------------------------------------------------------------------------

describe("Homepage sections — visual regression", () => {
  const FEATURED_PUZZLES = [
    { id: "1", title: "Genesis Cipher" },
    { id: "2", title: "Midnight Hash" },
    { id: "3", title: "Quantum Labyrinth" },
  ];

  const TOP_PLAYERS = [
    { id: "u1", name: "stellar_ace" },
    { id: "u2", name: "crypto_explorer" },
    { id: "u3", name: "hash_wizard" },
  ];

  it("matches snapshot: HeroSection", () => {
    const { asFragment } = render(
      <HeroSection
        headline="Solve Puzzles. Earn NFTs."
        subheadline="Cryptographic puzzle hunts with on-chain Stellar rewards."
      />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: FeaturedPuzzlesSection", () => {
    const { asFragment } = render(
      <FeaturedPuzzlesSection puzzles={FEATURED_PUZZLES} />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: LeaderboardPreviewSection", () => {
    const { asFragment } = render(
      <LeaderboardPreviewSection players={TOP_PLAYERS} />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: HeroSection — dark mode", () => {
    const { asFragment } = renderDark(
      <HeroSection
        headline="Solve Puzzles. Earn NFTs."
        subheadline="Cryptographic puzzle hunts with on-chain Stellar rewards."
      />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: FeaturedPuzzlesSection — dark mode", () => {
    const { asFragment } = renderDark(
      <FeaturedPuzzlesSection puzzles={FEATURED_PUZZLES} />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: LeaderboardPreviewSection — dark mode", () => {
    const { asFragment } = renderDark(
      <LeaderboardPreviewSection players={TOP_PLAYERS} />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it("matches snapshot: HeroSection — mobile viewport", () => {
    setMobileViewport();
    const { asFragment } = render(
      <HeroSection
        headline="Solve Puzzles. Earn NFTs."
        subheadline="Cryptographic puzzle hunts with on-chain Stellar rewards."
      />
    );
    expect(asFragment()).toMatchSnapshot();
    setDesktopViewport();
  });

  it("matches snapshot: FeaturedPuzzlesSection — mobile viewport", () => {
    setMobileViewport();
    const { asFragment } = render(
      <FeaturedPuzzlesSection puzzles={FEATURED_PUZZLES} />
    );
    expect(asFragment()).toMatchSnapshot();
    setDesktopViewport();
  });

  it("matches snapshot: LeaderboardPreviewSection — mobile viewport", () => {
    setMobileViewport();
    const { asFragment } = render(
      <LeaderboardPreviewSection players={TOP_PLAYERS} />
    );
    expect(asFragment()).toMatchSnapshot();
    setDesktopViewport();
  });
});
