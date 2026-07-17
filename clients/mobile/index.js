/**
 * React Native entry point. Registers the root component.
 *
 * `react-native-get-random-values` MUST be imported before anything reaches
 * `@cumulusvpn/core`: the shared keygen (@noble/curves x25519) calls
 * `crypto.getRandomValues`, which React Native's JS runtime (Hermes) does not
 * provide natively. This polyfill installs a CSPRNG backed by the platform
 * (SecRandomCopyBytes on iOS, SecureRandom on Android).
 * POC: it requires the native module to be linked (autolinking + pod install).
 */
import 'react-native-get-random-values';

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
