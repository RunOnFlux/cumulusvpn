/**
 * React Native entry point. Registers the root component.
 *
 * Two polyfills MUST load before anything reaches `@cumulusvpn/core`, because
 * the shared code is written for the browser (web/desktop) and touches Web APIs
 * that Hermes (RN's JS engine) does not provide:
 *   - `react-native-get-random-values` — `crypto.getRandomValues`, used by the
 *     keygen (@noble/curves x25519). Native module, linked via autolinking.
 *   - `text-encoding-polyfill` — `TextEncoder`/`TextDecoder`, constructed at
 *     module top-level in core (pow.ts, discovery.ts, http.ts). Without it the
 *     app crashes on launch with "Property 'TextDecoder' doesn't exist".
 */
import 'react-native-get-random-values';
import 'text-encoding-polyfill';

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
