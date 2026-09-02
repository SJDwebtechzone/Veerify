// src/components/BottomNavigation.js
//
// Shared bottom tab bar for every role's tab navigator (institution
// admin, trainer/staff, student, parent). One visual language across
// the whole Veerify app so a redesign lands in ONE place from now on.
//
// Usage — pass to `Tab.Navigator` via the `tabBar` prop, and set an
// `iconComponent` per Screen in `options`:
//
//   import BottomNavigation from '../components/BottomNavigation';
//   ...
//   <Tab.Navigator tabBar={(props) => <BottomNavigation {...props} />}>
//     <Tab.Screen name="Home" component={HomeScreen}
//       options={{ tabBarLabel: 'Home', iconComponent: House }} />
//   </Tab.Navigator>
//
// Behaviour:
//   • Active tab renders a soft pill (brand-red at 12% opacity) behind
//     the icon + a red icon at strokeWidth 2.2 + a red bold label.
//   • Inactive tabs render a muted-grey icon at strokeWidth 1.8 and a
//     muted-grey medium label. No background pill.
//   • Tap animation — the pill scales from 0.85 → 1 with a spring on
//     mount, and each Pressable dims to 0.6 opacity while pressed.
//   • Android safe-area / gesture bar respected via
//     useSafeAreaInsets — the bar sits above the system bottom inset
//     by a minimum of 8dp regardless of gestures being on/off.
//   • Subtle top border + soft upward shadow so the bar feels
//     elevated from the content behind it.
//   • Long-press support delegates to React Navigation's default
//     tabLongPress event.
//
// Icons are consumed from lucide-react-native — the app-wide policy
// is one icon library only. Add new tabs by dropping any lucide icon
// on the `iconComponent` option; no new library required.

import React, { useEffect, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '../theme';
import { useTheme } from '../theme/ThemeContext';

// One tab cell. Split out so it can own its own Animated value
// without triggering re-renders in siblings when its focus state
// flips. Colours come from props (resolved by the parent via
// useTheme) so a single hook call drives the whole bar.
function TabItem({
  Icon,
  label,
  focused,
  onPress,
  onLongPress,
  activeColor,
  inactiveColor,
  activeBg,
}) {
  // Pill scale — starts at 0.85 on non-focused, springs to 1 when
  // this tab becomes focused. The pill's opacity is driven by the
  // same value so it fades in as it scales up. Native driver — the
  // animation runs on the UI thread and never blocks JS.
  const scale = useRef(new Animated.Value(focused ? 1 : 0.85)).current;
  useEffect(() => {
    Animated.spring(scale, {
      toValue: focused ? 1 : 0.85,
      useNativeDriver: true,
      speed: 20,
      bounciness: 8,
    }).start();
  }, [focused, scale]);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      accessibilityLabel={label}
      android_ripple={{ color: 'rgba(239,68,68,0.10)', borderless: true, radius: 40 }}
      style={({ pressed }) => [
        styles.item,
        pressed && { opacity: 0.6 },
      ]}
    >
      <View style={styles.iconWrap}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.iconPill,
            {
              backgroundColor: activeBg,
              opacity: focused ? scale : 0,
              transform: [{ scale }],
            },
          ]}
        />
        {Icon ? (
          <Icon
            size={22}
            strokeWidth={focused ? 2.2 : 1.8}
            color={focused ? activeColor : inactiveColor}
          />
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          {
            color:      focused ? activeColor : inactiveColor,
            fontWeight: focused ? '700' : '500',
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function BottomNavigation({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  // Push above gesture bar / soft nav — always keep a minimum 8dp
  // breathing room even on devices that report a zero inset.
  const bottomPad = Math.max(insets.bottom, 8);
  // Colour tokens — read from useTheme() so a dark-mode flip repaints
  // the whole bar without a code change. Brand accent is preserved
  // (same red vivid in both themes); only surface + inactive text
  // shift.
  const activeColor   = palette.purple?.vivid    || '#EF4444';
  const activeBg      = palette.purple?.soft     || 'rgba(239, 68, 68, 0.12)';
  const inactiveColor = palette.textMuted        || '#6B7280';
  const surface       = palette.surface          || '#FFFFFF';
  const borderSoft    = palette.borderSoft       || '#F1F5F9';

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: surface,
          borderTopColor:  borderSoft,
          paddingBottom:   bottomPad,
        },
      ]}
    >
      <View style={styles.row}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          // Icon component — passed via options.iconComponent from
          // each Screen. Falls back to null so a missing icon just
          // renders the label instead of crashing the bar.
          const Icon = options.iconComponent || null;
          // Label — supports the standard react-navigation flavours:
          // a plain string via `tabBarLabel`, or the route name.
          let label = options.tabBarLabel;
          if (typeof label !== 'string') {
            label = options.title || route.name;
          }

          const onPress = () => {
            const event = navigation.emit({
              type:    'tabPress',
              target:  route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };
          const onLongPress = () => {
            navigation.emit({
              type:   'tabLongPress',
              target: route.key,
            });
          };

          return (
            <TabItem
              key={route.key}
              Icon={Icon}
              label={label}
              focused={focused}
              onPress={onPress}
              onLongPress={onLongPress}
              activeColor={activeColor}
              inactiveColor={inactiveColor}
              activeBg={activeBg}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Full-width surface with a subtle top border + upward shadow so
  // the bar feels elevated from the content behind it. Unlike the
  // previous floating card, this spans the entire bottom edge —
  // matches the "premium fitness app" reference direction (Nike
  // Training / Strong / Freeletics all use edge-to-edge bars).
  container: {
    // backgroundColor + borderTopColor are injected inline from
    // useTheme() so the bar repaints on light/dark flip.
    borderTopWidth: 1,
    // Soft upward shadow. On iOS via shadow*, on Android via
    // elevation. Kept subtle so it never competes with content.
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-around',
    paddingTop: 8,
    paddingHorizontal: spacing?.sm ?? 8,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    // Slight vertical rhythm so the icon + label combo doesn't feel
    // cramped against the top edge on tall bars.
    minHeight: 52,
  },
  iconWrap: {
    width:  44,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  // Rounded pill behind the icon on the active tab. Sized generously
  // so it hugs the 22dp icon with clean breathing room on both axes.
  iconPill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
  },
  label: {
    fontSize: 13,
    marginTop: 4,
    letterSpacing: 0.2,
  },
});
