// React Native autolinking config.
//
// Block @react-native-community/geolocation from autolinking. The package
// ships an incomplete codegen JNI directory and its CMake step fails on
// the New Architecture (RN 0.85+). We use react-native-geolocation-service
// instead, which handles autolinking correctly.
//
// We leave this entry in place so that even if the broken package gets
// re-installed transitively (or `npm uninstall` doesn't fully remove it),
// the build still succeeds.
module.exports = {
  dependencies: {
    '@react-native-community/geolocation': {
      platforms: {
        android: null,
        ios: null,
      },
    },
  },
};
