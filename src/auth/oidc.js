'use strict';

/**
 * Google OpenID Connect client.
 *
 * Flow (authorization code + PKCE + nonce + state):
 *   1. The server stores `state`, `nonce` and the PKCE verifier in the database.
 *   2. The browser is redirected to Google's authorization endpoint.
 *   3. Google redirects back with `code` and the same `state`.
 *   4. The server exchanges the code for tokens over a server-to-server call.
 *   5. The ID token signature, issuer, audience, expiry, and nonce are verified
 *      with Google's published JWKS before any session is created.
 *
 * CyberSafe therefore never sees or stores a Google password, and no browser
 * supplied value (email, role, "signed in" flag) is trusted on its own.
 */

const crypto = require('node:crypto');
const { AppError } = require('../errors');

let josePromise = null;
/** jose ships as an ES module; load it lazily from CommonJS. */
function loadJose() {
  if (!josePromise) josePromise = import('jose');
  return josePromise;
}

function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * @param {{config: any, fetchImpl?: typeof fetch}} deps
 */
function createGoogleClient({ config, fetchImpl = globalThis.fetch }) {
  const { clientId, clientSecret, issuer, redirectUri } = config.google;
  const allowedIssuers = ['https://accounts.google.com', 'accounts.google.com'];

  /** @type {any} */
  let discovery = null;
  /** @type {any} */
  let jwks = null;

  async function getDiscovery() {
    if (discovery) return discovery;
    const discoveryUrl = new URL('/.well-known/openid-configuration', issuer).toString();

    let response;
    try {
      response = await fetchImpl(discoveryUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      throw new AppError(503, 'Google sign-in could not be reached. Check your connection and try again.', {
        code: 'oidc_unavailable',
        details: { cause: error.message },
      });
    }

    if (!response.ok) {
      throw new AppError(503, 'Google sign-in is temporarily unavailable. Please try again shortly.', {
        code: 'oidc_discovery_failed',
        details: { status: response.status },
      });
    }

    const document = await response.json();
    const required = ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'];
    for (const key of required) {
      if (!document[key]) {
        throw new AppError(503, 'Google sign-in returned an unexpected configuration.', {
          code: 'oidc_discovery_incomplete',
          details: { missing: key },
        });
      }
    }

    discovery = {
      issuer: document.issuer,
      authorizationEndpoint: document.authorization_endpoint,
      tokenEndpoint: document.token_endpoint,
      jwksUri: document.jwks_uri,
    };
    return discovery;
  }

  async function getJwks() {
    if (!jwks) {
      const { createRemoteJWKSet } = await loadJose();
      const document = await getDiscovery();
      jwks = createRemoteJWKSet(new URL(document.jwksUri));
    }
    return jwks;
  }

  return {
    configured: Boolean(config.google.configured),

    /** @param {{state: string, nonce: string, codeChallenge: string}} input */
    async buildAuthorizationUrl({ state, nonce, codeChallenge }) {
      if (!this.configured) {
        throw new AppError(503, 'Google sign-in is not configured on this server.', {
          code: 'oauth_not_configured',
        });
      }
      const document = await getDiscovery();
      const url = new URL(document.authorizationEndpoint);
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('access_type', 'online');
      url.searchParams.set('prompt', 'select_account');
      return url.toString();
    },

    /**
     * Exchange the authorization code and verify the resulting ID token.
     * @param {{code: string, codeVerifier: string, expectedNonce: string}} input
     * @returns {Promise<{googleSub: string, email: string, emailVerified: boolean, name: string|null}>}
     */
    async exchangeCodeAndVerify({ code, codeVerifier, expectedNonce }) {
      if (!this.configured) {
        throw new AppError(503, 'Google sign-in is not configured on this server.', {
          code: 'oauth_not_configured',
        });
      }
      const document = await getDiscovery();

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      });

      let response;
      try {
        response = await fetchImpl(document.tokenEndpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json',
          },
          body,
          signal: AbortSignal.timeout(10000),
        });
      } catch (error) {
        throw new AppError(503, 'Google sign-in could not complete. Please try again.', {
          code: 'oidc_token_unreachable',
          details: { cause: error.message },
        });
      }

      if (!response.ok) {
        let providerError = null;
        try {
          providerError = (await response.json()).error || null;
        } catch {
          providerError = null;
        }
        throw new AppError(401, 'Google could not verify this sign-in. Please try again.', {
          code: 'oidc_token_rejected',
          details: { status: response.status, providerError },
        });
      }

      const tokens = await response.json();
      if (!tokens || typeof tokens.id_token !== 'string') {
        throw new AppError(401, 'Google did not return an identity token. Please try again.', {
          code: 'oidc_missing_id_token',
        });
      }

      const { jwtVerify } = await loadJose();
      let payload;
      try {
        const result = await jwtVerify(tokens.id_token, await getJwks(), {
          issuer: allowedIssuers,
          audience: clientId,
          algorithms: ['RS256'],
          clockTolerance: 10,
          maxTokenAge: '1h',
        });
        payload = result.payload;
      } catch (error) {
        throw new AppError(401, 'Google returned a sign-in token we could not trust. Please try again.', {
          code: 'oidc_token_invalid',
          details: { reason: error.code || error.message },
        });
      }

      if (!payload.sub) {
        throw new AppError(401, 'Google did not return an account identifier.', {
          code: 'oidc_missing_sub',
        });
      }
      if (payload.nonce !== expectedNonce) {
        throw new AppError(401, 'This sign-in attempt could not be verified. Please start again.', {
          code: 'oidc_nonce_mismatch',
        });
      }
      if (typeof payload.email !== 'string' || payload.email.length === 0) {
        throw new AppError(403, 'Your Google account did not share an email address.', {
          code: 'oidc_missing_email',
        });
      }
      if (payload.email_verified !== true) {
        throw new AppError(403, 'Your Google email address is not verified yet.', {
          code: 'oidc_email_unverified',
        });
      }

      return {
        googleSub: payload.sub,
        email: payload.email.toLowerCase(),
        emailVerified: true,
        name: typeof payload.name === 'string' ? payload.name : null,
      };
    },
  };
}

module.exports = { createGoogleClient, createPkcePair, loadJose };
