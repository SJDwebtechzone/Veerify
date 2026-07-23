import * as Keychain from 'react-native-keychain';

const TOKEN_KEY = 'userToken';

export const saveToken = async (token) => {
  try {
    await Keychain.setGenericPassword(TOKEN_KEY, token);
    return true;
  } catch (err) {
    console.error('Save token error:', err);
    return false;
  }
};

// On a cold first Android launch the AndroidKeyStore isn't always
// ready when React Native asks for it — Keychain.getGenericPassword()
// can throw a KeyStoreException the very first time it's called. On
// the second launch the keystore is warm and the same call succeeds,
// which perfectly matches the "app crashes only on first launch,
// works on second" symptom.
//
// Two small guards:
//   1. Retry once after a short backoff — enough for the keystore to
//      settle without meaningfully delaying login.
//   2. Never rethrow. A failed keychain read is indistinguishable from
//      "no saved token" for the caller (both mean: show Welcome),
//      so returning null keeps startup deterministic.
export const getToken = async () => {
  const attempt = async () => {
    try {
      const credentials = await Keychain.getGenericPassword();
      return credentials ? credentials.password : null;
    } catch (err) {
      return { __err: err };
    }
  };
  const first = await attempt();
  if (first && typeof first === 'object' && first.__err) {
    // First-call flake — wait a beat and try once more.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const second = await attempt();
    if (second && typeof second === 'object' && second.__err) {
      // eslint-disable-next-line no-console
      console.log('[Storage] getToken failed twice, treating as signed out:', second.__err?.message);
      return null;
    }
    return second;
  }
  return first;
};

export const deleteToken = async () => {
  try {
    await Keychain.resetGenericPassword();
    return true;
  } catch (err) {
    console.error('Delete token error:', err);
    return false;
  }
};