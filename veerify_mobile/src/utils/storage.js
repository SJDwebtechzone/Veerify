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

export const getToken = async () => {
  try {
    const credentials = await Keychain.getGenericPassword();
    if (credentials) return credentials.password;
    return null;
  } catch (err) {
    console.error('Get token error:', err);
    return null;
  }
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