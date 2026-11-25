# Guide: Integrating Stellar Wallet in Frontend

> Issue #990 — `stellar-extensions/docs/`

This guide explains how to connect a Stellar wallet (Freighter, xBull, etc.)
in the StellarHunts frontend for authentication and transaction signing.

---

## Table of Contents

1. [Wallet Connection Flow](#1-wallet-connection-flow)
2. [Connecting Freighter Wallet](#2-connecting-freighter-wallet)
3. [Signing the Authentication Challenge](#3-signing-the-authentication-challenge)
4. [Signing a Transaction for NFT Claim](#4-signing-a-transaction-for-nft-claim)
5. [Error Handling — Wallet Not Installed](#5-error-handling--wallet-not-installed)
6. [Network Switching (Mainnet / Testnet)](#6-network-switching-mainnet--testnet)

---

## 1. Wallet Connection Flow

```
User clicks "Connect Wallet"
        │
        ▼
Check if Freighter (or xBull) is installed
        │
  ┌─────┴────────────────────────┐
  │ Not installed                │ Installed
  ▼                              ▼
Show install prompt        Request public key
(or offer WalletConnect)   from the extension
                                 │
                                 ▼
                         POST /wallet/challenge
                         (server returns nonce)
                                 │
                                 ▼
                         Sign challenge message
                         with wallet private key
                                 │
                                 ▼
                         POST /wallet/verify
                         (server issues JWT)
                                 │
                                 ▼
                         Store token in memory
                         App is now authenticated
```

The backend issues either a **wallet-only session** or a **full account token**
depending on whether the wallet is linked to a registered account.
See `docs/wallet-auth.md` for backend details.

---

## 2. Connecting Freighter Wallet

Freighter exposes its API via `@stellar/freighter-api`.

```js
// stellar-extensions/docs/examples/connect-freighter.js

import {
  isConnected,
  getPublicKey,
  requestAccess,
} from "@stellar/freighter-api";

/**
 * Connect the Freighter wallet.
 * Returns the user's public key (G... address) on success.
 * Throws if the wallet is not installed or access is denied.
 */
export async function connectFreighter() {
  // 1. Check installation
  const connected = await isConnected();
  if (!connected) {
    throw new Error("WALLET_NOT_INSTALLED");
  }

  // 2. Request permission (shows the Freighter popup if not yet granted)
  await requestAccess();

  // 3. Read the public key
  const publicKey = await getPublicKey();
  if (!publicKey) {
    throw new Error("WALLET_NO_PUBLIC_KEY");
  }

  return publicKey; // e.g. "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGBXC4...
}
```

### Connecting xBull

xBull injects `window.xBullSDK` and follows a similar pattern:

```js
// stellar-extensions/docs/examples/connect-xbull.js

export async function connectXBull() {
  if (!window.xBullSDK) {
    throw new Error("WALLET_NOT_INSTALLED");
  }

  await window.xBullSDK.connect({ canRequestPublicKey: true });
  const { publicKey } = await window.xBullSDK.getPublicKey({});

  if (!publicKey) {
    throw new Error("WALLET_NO_PUBLIC_KEY");
  }

  return publicKey;
}
```

---

## 3. Signing the Authentication Challenge

After obtaining the public key, request a nonce from the backend and sign it:

```js
// stellar-extensions/docs/examples/authenticate.js

import { signMessage } from "@stellar/freighter-api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * Full authentication flow:
 *   1. Fetch a challenge nonce from the server.
 *   2. Sign it with the user's wallet.
 *   3. Submit the signature to get a session token.
 *
 * @param {string} walletAddress  — The connected public key (G... address).
 * @returns {Promise<{accessToken: string, linked: boolean}>}
 */
export async function authenticateWithWallet(walletAddress) {
  // Step 1: Request a server-issued challenge
  const challengeRes = await fetch(`${API_BASE}/wallet/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress }),
  });

  if (!challengeRes.ok) {
    const err = await challengeRes.json().catch(() => ({}));
    throw new Error(err.message ?? "Failed to fetch challenge");
  }

  const { nonce, message } = await challengeRes.json();

  // Step 2: Sign the challenge message (Freighter shows a confirmation popup)
  const { signedMessage, error: signError } = await signMessage(message, {
    accountToSign: walletAddress,
  });

  if (signError) {
    throw new Error(`Signing failed: ${signError}`);
  }

  // Step 3: Submit the signed message to verify identity
  const verifyRes = await fetch(`${API_BASE}/wallet/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress,
      nonce,
      signature: signedMessage,
    }),
  });

  if (!verifyRes.ok) {
    const err = await verifyRes.json().catch(() => ({}));
    throw new Error(err.message ?? "Verification failed");
  }

  const session = await verifyRes.json();
  // session.accessToken is a JWT — store in memory, NOT localStorage
  return session;
}
```

> **Security note:** Store `accessToken` in React state or a closure, not
> `localStorage`. This prevents XSS from exfiltrating the token.

---

## 4. Signing a Transaction for NFT Claim

When the backend returns a base64-encoded XDR envelope for an NFT claim,
sign it with Freighter and submit it to Horizon:

```js
// stellar-extensions/docs/examples/sign-nft-claim.js

import { signTransaction } from "@stellar/freighter-api";

const HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ??
  "https://horizon-testnet.stellar.org";

const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
  "Test SDF Network ; September 2015";

/**
 * Sign an NFT-claim XDR transaction with Freighter and submit it to Horizon.
 *
 * @param {string} xdr           — Base64-encoded unsigned transaction XDR.
 * @param {string} walletAddress — Signer's public key.
 * @returns {Promise<{hash: string}>} — Submitted transaction hash.
 */
export async function signAndSubmitNftClaim(xdr, walletAddress) {
  // 1. Ask Freighter to sign the XDR
  const { signedXDR, error: signError } = await signTransaction(xdr, {
    accountToSign: walletAddress,
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  if (signError) {
    throw new Error(`Transaction signing failed: ${signError}`);
  }

  // 2. Submit the signed XDR to Horizon
  const submitRes = await fetch(`${HORIZON_URL}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ tx: signedXDR }),
  });

  const result = await submitRes.json();

  if (!submitRes.ok) {
    const detail =
      result?.extras?.result_codes?.transaction ??
      result?.title ??
      "Transaction submission failed";
    throw new Error(detail);
  }

  return { hash: result.hash };
}
```

---

## 5. Error Handling — Wallet Not Installed

Always guard against missing wallet extensions before calling their APIs:

```js
// stellar-extensions/docs/examples/wallet-error-handling.js

import { isConnected } from "@stellar/freighter-api";

/**
 * Returns true when Freighter is detected in the browser.
 * Works in SSR environments (window guard).
 */
export async function isFreighterInstalled() {
  if (typeof window === "undefined") return false;
  try {
    return await isConnected();
  } catch {
    return false;
  }
}

/**
 * Categorised error codes returned by wallet helpers.
 *
 * WALLET_NOT_INSTALLED — Extension is absent; show an install CTA.
 * WALLET_NO_PUBLIC_KEY — Extension present but returned no key (locked?).
 * WALLET_USER_REJECTED — User dismissed the popup.
 * WALLET_SIGN_FAILED   — Signing produced an error string.
 * NETWORK_MISMATCH     — Wallet is on a different network than the app expects.
 */
export const WalletErrorCode = {
  NOT_INSTALLED: "WALLET_NOT_INSTALLED",
  NO_PUBLIC_KEY: "WALLET_NO_PUBLIC_KEY",
  USER_REJECTED: "WALLET_USER_REJECTED",
  SIGN_FAILED: "WALLET_SIGN_FAILED",
  NETWORK_MISMATCH: "NETWORK_MISMATCH",
};

/**
 * UI-friendly error messages for each code.
 */
export function walletErrorMessage(code) {
  const messages = {
    [WalletErrorCode.NOT_INSTALLED]:
      "Freighter wallet is not installed. Please add the browser extension and reload.",
    [WalletErrorCode.NO_PUBLIC_KEY]:
      "Could not read your public key. Is your wallet unlocked?",
    [WalletErrorCode.USER_REJECTED]:
      "You rejected the wallet request. Please try again and approve the popup.",
    [WalletErrorCode.SIGN_FAILED]:
      "Signing failed. Please check your wallet and try again.",
    [WalletErrorCode.NETWORK_MISMATCH]:
      "Your wallet is connected to the wrong network. Please switch networks and retry.",
  };
  return messages[code] ?? "An unexpected wallet error occurred.";
}

/**
 * Example React usage:
 *
 * try {
 *   const publicKey = await connectFreighter();
 * } catch (err) {
 *   const code = err.message; // one of WalletErrorCode values
 *   showToast(walletErrorMessage(code));
 * }
 */
```

---

## 6. Network Switching (Mainnet / Testnet)

Freighter and xBull both expose the active network. Verify the wallet is on
the expected network before proceeding:

```js
// stellar-extensions/docs/examples/network-switch.js

import { getNetworkDetails, requestAccess } from "@stellar/freighter-api";

const EXPECTED_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
  "Test SDF Network ; September 2015";

const NETWORK_LABEL =
  EXPECTED_PASSPHRASE === "Public Global Stellar Network ; September 2015"
    ? "Mainnet"
    : "Testnet";

/**
 * Check that Freighter is on the expected Stellar network.
 * Throws with code NETWORK_MISMATCH when they disagree.
 */
export async function assertCorrectNetwork() {
  await requestAccess();
  const { networkPassphrase } = await getNetworkDetails();

  if (networkPassphrase !== EXPECTED_PASSPHRASE) {
    const err = new Error("NETWORK_MISMATCH");
    err.detail = {
      expected: EXPECTED_PASSPHRASE,
      actual: networkPassphrase,
      expectedLabel: NETWORK_LABEL,
    };
    throw err;
  }
}

/**
 * Full connect-with-network-check flow:
 *
 *   const publicKey = await connectFreighterOnCorrectNetwork();
 *   // Guaranteed to be on EXPECTED_PASSPHRASE network
 */
export async function connectFreighterOnCorrectNetwork() {
  const { isConnected: freighterIsConnected } = await import(
    "@stellar/freighter-api"
  );
  const connected = await freighterIsConnected();
  if (!connected) throw new Error("WALLET_NOT_INSTALLED");

  await assertCorrectNetwork(); // throws NETWORK_MISMATCH when wrong
  const { getPublicKey } = await import("@stellar/freighter-api");
  return getPublicKey();
}

/**
 * React hook usage pattern:
 *
 * try {
 *   await assertCorrectNetwork();
 * } catch (err) {
 *   if (err.message === "NETWORK_MISMATCH") {
 *     setError(
 *       `Please switch Freighter to ${err.detail.expectedLabel} and try again.`
 *     );
 *   }
 * }
 *
 * To help the user switch networks, Freighter's Settings > Network lets them
 * toggle between Public Network and Test SDF Network; there is no programmatic
 * API to force-switch the wallet's active network.
 */
```

---

## Reference

| File | Description |
|---|---|
| `frontend/lib/walletconnect.js` | WalletConnect v2 pairing & session helpers |
| `frontend/hooks/useWalletConnection.js` | React hook wrapping Freighter + WalletConnect |
| `docs/wallet-auth.md` | Backend challenge/verify API reference |
| `@stellar/freighter-api` | Official Freighter browser-extension npm package |
