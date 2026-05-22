import React, { useState } from 'react';
import {
  View, Text, Image, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, Platform
} from 'react-native';
import apiClient from '../../api/client';
import { colors } from '../../utils/styles';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';


// Institution types from client document
const INSTITUTION_TYPES = [
  'Karate',
  'Silambam',
  'Taekwondo',
  'Boxing',
  'Muay Thai',
  'BJJ (Brazilian Jiu-Jitsu)',
  'Judo',
  'Kung Fu',
  'Mixed Martial Arts (MMA)',
  'Self Defense',
  'Kalaripayattu',
  'Other Martial Arts',
];

export default function SetupInstitutionScreen({ navigation }) {

  // ✅ These belong HERE — inside the function
  const [loading, setLoading] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [logoUri, setLogoUri] = useState(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [form, setForm] = useState({
    name: '',
    institution_type: '',
    website_url: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    pincode: '',
    registration_number: '',
    master_name: '',
  });


  const updateField = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const validate = () => {
    if (!form.name) return 'Institution Name is required';
    if (!form.institution_type) return 'Institution Type is required';
    if (!form.email) return 'Contact Email is required';
    if (!/\S+@\S+\.\S+/.test(form.email)) return 'Please enter a valid email';
    if (!form.phone) return 'Phone Number is required';
    if (form.phone.length < 10) return 'Please enter a valid phone number';
    if (!form.address) return 'Physical Address is required';
    if (!form.registration_number) return 'Registration Number is required';
    if (!form.master_name) return 'Master Name is required';
    if (form.website_url && !form.website_url.startsWith('http')) {
      return 'Website URL must start with http:// or https://';
    }
    return null;
  };

 const handleSubmit = async () => {
  const error = validate();
  if (error) {
    Alert.alert('Validation Error', error);
    return;
  }

  setLoading(true);
  try {
    await apiClient.post('/onboarding/setup', {
      ...form,
      logo_url: logoUrl || null   // ← include logo URL
    });

    navigation.reset({
      index: 0,
      routes: [{ name: 'PendingApproval' }],
    });
  } catch (err) {
    Alert.alert(
      'Submission Failed',
      err.response?.data?.message || 'Something went wrong. Please try again.'
    );
  } finally {
    setLoading(false);
  }
};
const handlePickLogo = () => {
  Alert.alert(
    'Upload Logo',
    'Choose how to upload your academy logo',
    [
      {
        text: 'Choose from Gallery',
        onPress: () => pickFromGallery()
      },
      {
        text: 'Take Photo',
        onPress: () => takePhoto()
      },
      {
        text: 'Cancel',
        style: 'cancel'
      }
    ]
  );
};

const pickFromGallery = () => {
  launchImageLibrary(
    {
      mediaType: 'photo',
      quality: 0.8,
      maxWidth: 500,
      maxHeight: 500,
    },
    (response) => {
      if (!response.didCancel && !response.errorCode) {
        const asset = response.assets[0];
        uploadLogo(asset);
      }
    }
  );
};

const takePhoto = () => {
  launchCamera(
    {
      mediaType: 'photo',
      quality: 0.8,
      maxWidth: 500,
      maxHeight: 500,
    },
    (response) => {
      if (!response.didCancel && !response.errorCode) {
        const asset = response.assets[0];
        uploadLogo(asset);
      }
    }
  );
};

const uploadLogo = async (asset) => {
  setUploadingLogo(true);
  setLogoUri(asset.uri);

  try {
    const formData = new FormData();
    formData.append('logo', {
      uri: asset.uri,
      type: asset.type || 'image/jpeg',
      name: asset.fileName || 'logo.jpg',
    });

    const response = await apiClient.post('/uploads/logo', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    setLogoUrl(response.data.logo_url);
    Alert.alert('Success! ✅', 'Logo uploaded successfully');
  } catch (err) {
    console.error('Logo upload error:', err);
    Alert.alert('Upload Failed', 'Failed to upload logo. Please try again.');
    setLogoUri(null);
  } finally {
    setUploadingLogo(false);
  }
};
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Set Up Your Academy</Text>
        <Text style={styles.headerSubtitle}>
          Fill in your academy details. Our team will review and approve within 24-48 hours.
        </Text>
      </View>

      {/* Progress indicator */}
      <View style={styles.progressRow}>
        <View style={styles.progressStep}>
          <View style={[styles.progressDot, styles.progressDotDone]}>
            <Text style={styles.progressDotText}>✓</Text>
          </View>
          <Text style={styles.progressLabel}>Plan</Text>
        </View>
        <View style={styles.progressLine} />
        <View style={styles.progressStep}>
          <View style={[styles.progressDot, styles.progressDotActive]}>
            <Text style={styles.progressDotText}>2</Text>
          </View>
          <Text style={[styles.progressLabel, { color: colors.primary }]}>Details</Text>
        </View>
        <View style={styles.progressLine} />
        <View style={styles.progressStep}>
          <View style={styles.progressDot}>
            <Text style={styles.progressDotText}>3</Text>
          </View>
          <Text style={styles.progressLabel}>Review</Text>
        </View>
        <View style={styles.progressLine} />
        <View style={styles.progressStep}>
          <View style={styles.progressDot}>
            <Text style={styles.progressDotText}>4</Text>
          </View>
          <Text style={styles.progressLabel}>Payment</Text>
        </View>
      </View>

      {/* ── FIELD 1: Institution Name ── */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>
          Institution Name <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={form.name}
          onChangeText={v => updateField('name', v)}
          placeholder="e.g. Chennai Karate Academy"
          placeholderTextColor={colors.gray}
          maxLength={255}
        />
      </View>

      {/* ── FIELD 2: Institution Type (Dropdown) ── */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>
          Institution Type <Text style={styles.required}>*</Text>
        </Text>
        <TouchableOpacity
          style={[styles.input, styles.dropdownButton]}
          onPress={() => setShowTypeDropdown(!showTypeDropdown)}
          activeOpacity={0.8}
        >
          <Text style={form.institution_type ? styles.dropdownSelected : styles.dropdownPlaceholder}>
            {form.institution_type || 'Select type...'}
          </Text>
          <Text style={styles.dropdownArrow}>{showTypeDropdown ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {showTypeDropdown && (
          <View style={styles.dropdownList}>
            {INSTITUTION_TYPES.map((type) => (
              <TouchableOpacity
                key={type}
                style={[
                  styles.dropdownItem,
                  form.institution_type === type && styles.dropdownItemSelected
                ]}
                onPress={() => {
                  updateField('institution_type', type);
                  setShowTypeDropdown(false);
                }}
              >
                <Text style={[
                  styles.dropdownItemText,
                  form.institution_type === type && styles.dropdownItemTextSelected
                ]}>
                  {type}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* ── FIELD 3: Website URL ── */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>
          Website URL <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={form.website_url}
          onChangeText={v => updateField('website_url', v)}
          placeholder="https://www.youracademy.com"
          placeholderTextColor={colors.gray}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* ── FIELD 4: Contact Email ── */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>
          Contact Email <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={form.email}
          onChangeText={v => updateField('email', v)}
          placeholder="academy@example.com"
          placeholderTextColor={colors.gray}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* ── FIELD 5: Phone Number ── */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>
          Phone Number <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={form.phone}
          onChangeText={v => updateField('phone', v)}
          placeholder="9876543210"
          placeholderTextColor={colors.gray}
          keyboardType="phone-pad"
          maxLength={15}
        />
      </View>

      {/* ── FIELD 6: Physical Address ── */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>
          Physical Address <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={form.address}
          onChangeText={v => updateField('address', v)}
          placeholder="Full address including street, area..."
          placeholderTextColor={colors.gray}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
      </View>

      {/* ── City + Pincode row ── */}
      <View style={styles.row}>
        <View style={[styles.fieldGroup, { flex: 1, marginRight: 8 }]}>
          <Text style={styles.label}>City</Text>
          <TextInput
            style={styles.input}
            value={form.city}
            onChangeText={v => updateField('city', v)}
            placeholder="Chennai"
            placeholderTextColor={colors.gray}
          />
        </View>
        <View style={[styles.fieldGroup, { flex: 1, marginLeft: 8 }]}>
          <Text style={styles.label}>Pincode</Text>
          <TextInput
            style={styles.input}
            value={form.pincode}
            onChangeText={v => updateField('pincode', v)}
            placeholder="600001"
            placeholderTextColor={colors.gray}
            keyboardType="numeric"
            maxLength={6}
          />
        </View>
      </View>

 {/* ── FIELD 7: Logo Upload ── */}
<View style={styles.fieldGroup}>
  <Text style={styles.label}>
    Academy Logo <Text style={styles.required}>*</Text>
  </Text>

  <TouchableOpacity
    style={[
      styles.uploadButton,
      logoUri && styles.uploadButtonDone
    ]}
    onPress={handlePickLogo}
    disabled={uploadingLogo}
    activeOpacity={0.8}
  >
    {uploadingLogo ? (
      <ActivityIndicator color={colors.primary} size="large" />
    ) : logoUri ? (
      // Show preview after selection
      <>
        <Image
          source={{ uri: logoUri }}
          style={styles.logoPreview}
          resizeMode="cover"
        />
        <Text style={styles.uploadDoneText}>✅ Logo uploaded!</Text>
        <Text style={styles.uploadChangeText}>Tap to change</Text>
      </>
    ) : (
      // Default upload UI
      <>
        <Text style={styles.uploadIcon}>📷</Text>
        <Text style={styles.uploadText}>Upload Academy Logo</Text>
        <Text style={styles.uploadHint}>PNG or JPG • Max 5MB</Text>
        <Text style={styles.uploadHint}>Tap to choose from gallery or camera</Text>
      </>
    )}
  </TouchableOpacity>
</View>

      {/* ── FIELD 8: Registration Number ── */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>
          Registration Number <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={form.registration_number}
          onChangeText={v => updateField('registration_number', v)}
          placeholder="e.g. TN/MA/2024/001"
          placeholderTextColor={colors.gray}
          autoCapitalize="characters"
        />
        <Text style={styles.hint}>
          Enter your official martial arts federation registration number
        </Text>
      </View>

      {/* ── FIELD 9: Master Name ── */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>
          Master Name <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={form.master_name}
          onChangeText={v => updateField('master_name', v)}
          placeholder="e.g. Sensei Rajesh Kumar"
          placeholderTextColor={colors.gray}
        />
        <Text style={styles.hint}>
          Name of the head instructor or master of your academy
        </Text>
      </View>

      {/* Declaration */}
      <View style={styles.declarationBox}>
        <Text style={styles.declarationText}>
          📋 By submitting this form, you confirm that all information provided is accurate and complete. False information may result in rejection of your application.
        </Text>
      </View>

      {/* Submit button */}
      <TouchableOpacity
        style={[styles.submitButton, loading && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={loading}
        activeOpacity={0.85}
      >
        {loading ? (
          <ActivityIndicator color={colors.white} size="large" />
        ) : (
          <>
            <Text style={styles.submitButtonText}>Submit for Review</Text>
            <Text style={styles.submitButtonSubtext}>
              Our team will review within 24-48 hours
            </Text>
          </>
        )}
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f4f8' },
  content: { padding: 20 },

  // Header
  header: { marginBottom: 24 },
  headerTitle: {
    fontSize: 24, fontWeight: '700',
    color: '#1a1a2e', marginBottom: 8
  },
  headerSubtitle: {
    fontSize: 13, color: '#666',
    lineHeight: 20
  },

  // Progress
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
    paddingHorizontal: 8,
  },
  progressStep: { alignItems: 'center', gap: 4 },
  progressLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#e0e0e8',
    marginHorizontal: 4,
    marginBottom: 16,
  },
  progressDot: {
    width: 28, height: 28,
    borderRadius: 14,
    backgroundColor: '#e0e0e8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressDotDone: { backgroundColor: '#06d6a0' },
  progressDotActive: { backgroundColor: '#e63946' },
  progressDotText: { fontSize: 11, fontWeight: '700', color: 'white' },
  progressLabel: { fontSize: 10, color: '#888', marginTop: 2 },

  // Fields
  fieldGroup: { marginBottom: 16 },
  label: {
    fontSize: 13, fontWeight: '600',
    color: '#1a1a2e', marginBottom: 6
  },
  required: { color: '#e63946' },
  optional: { color: '#888', fontWeight: '400' },
  hint: {
    fontSize: 11, color: '#888',
    marginTop: 4, lineHeight: 16
  },

  input: {
    backgroundColor: 'white',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e0e0e8',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1a1a2e',
  },
  textarea: {
    minHeight: 80,
    paddingTop: 12,
  },

  row: { flexDirection: 'row' },

  // Dropdown
  dropdownButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dropdownSelected: { fontSize: 15, color: '#1a1a2e' },
  dropdownPlaceholder: { fontSize: 15, color: '#888' },
  dropdownArrow: { fontSize: 12, color: '#888' },
  dropdownList: {
    backgroundColor: 'white',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e0e0e8',
    marginTop: 4,
    maxHeight: 200,
    overflow: 'scroll',
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f4f4f8',
  },
  dropdownItemSelected: { backgroundColor: '#fff5f5' },
  dropdownItemText: { fontSize: 14, color: '#1a1a2e' },
  dropdownItemTextSelected: { color: '#e63946', fontWeight: '600' },

  // Logo upload
  uploadButton: {
    backgroundColor: 'white',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#e0e0e8',
    borderStyle: 'dashed',
    padding: 20,
    alignItems: 'center',
    gap: 4,
    position: 'relative',
  },
  uploadIcon: { fontSize: 32 },
  uploadText: { fontSize: 14, fontWeight: '600', color: '#1a1a2e' },
  uploadHint: { fontSize: 12, color: '#888' },
  comingSoonBadge: {
    backgroundColor: '#faeeda',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    marginTop: 4,
  },
  comingSoonText: { fontSize: 11, color: '#854f0b', fontWeight: '600' },

  // Declaration
  declarationBox: {
    backgroundColor: '#e6f1fb',
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
    marginTop: 4,
  },
  declarationText: {
    fontSize: 12, color: '#185fa5', lineHeight: 18
  },

  // Submit
  submitButton: {
    backgroundColor: '#e63946',
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: 'center',
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: {
    fontSize: 17, fontWeight: '700', color: 'white'
  },
  submitButtonSubtext: {
    fontSize: 11, color: 'rgba(255,255,255,0.8)', marginTop: 3
  },
  uploadButtonDone: {
    borderColor: colors.success,
    borderStyle: 'solid',
    borderWidth: 2,
  },
  logoPreview: {
    width: 100,
    height: 100,
    borderRadius: 12,
    marginBottom: 8,
  },
  uploadDoneText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.success,
  },
  uploadChangeText: {
    fontSize: 12,
    color: colors.gray,
    marginTop: 4,
  },
});