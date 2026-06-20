// src/components/PasswordInput.js
//
// Reusable password input with a toggle-visibility eye icon on the right.
// Drop-in replacement for a TextInput with `secureTextEntry`.
//
// Props:
//   value, onChangeText, placeholder, placeholderTextColor   — same as TextInput
//   style                                                     — overrides on the wrapper
//   inputStyle                                                — overrides on the inner TextInput
//   iconColor                                                 — tint for the eye icon
//   autoCapitalize, autoCorrect, returnKeyType, onSubmitEditing, maxLength
//                                                             — passed through

import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';

export default function PasswordInput({
  value,
  onChangeText,
  placeholder,
  placeholderTextColor,
  style,
  inputStyle,
  iconColor = '#6B7280',
  ...rest
}) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={[styles.wrap, style]}>
      <TextInput
        style={[styles.input, inputStyle]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        {...rest}
      />
      <TouchableOpacity
        onPress={() => setVisible((v) => !v)}
        style={styles.eyeBtn}
        hitSlop={8}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
      >
        {visible
          ? <EyeOff size={18} color={iconColor} strokeWidth={2.2} />
          : <Eye    size={18} color={iconColor} strokeWidth={2.2} />}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  input: {
    flex: 1,
    paddingRight: 44, // leave room for the eye button
  },
  eyeBtn: {
    position: 'absolute',
    right: 4,
    top: 0,
    bottom: 0,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
