import React from 'react';
import { 
  View, Text, TouchableOpacity, StyleSheet, StatusBar, 
  Image, ScrollView, Dimensions 
} from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function WelcomeScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a4d8c" />

      {/* Decorative emojis in background */}
      <Text style={styles.bgEmojiTopRight}>🥋</Text>
      <Text style={styles.bgEmojiBottomLeft}>🥊</Text>
      <Text style={styles.bgEmojiMiddle}>🦵</Text>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Top: Logo */}
        <View style={styles.logoRow}>
          <View style={styles.logoBox}>
            <Image
              source={require('../assets/veerify-logo.png')}
              style={styles.logoImage}
              resizeMode="cover"
            />
          </View>
          <Text style={styles.logoText}>Veerify</Text>
        </View>

        {/* Middle: Hero text */}
        <View style={styles.heroContent}>
          {/* Badge */}
          <View style={styles.badge}>
            <Text style={styles.badgeText}>★ #1 MARTIAL ARTS APP</Text>
          </View>

          {/* Big headline */}
          <Text style={styles.headline}>Begin your</Text>
          <Text style={styles.headline}>martial arts</Text>
          <Text style={[styles.headline, styles.headlineYellow]}>journey today.</Text>

          {/* Subtitle */}
          <Text style={styles.subtitle}>
            Join 1000+ students learning Karate, Taekwondo, BJJ, and more from certified masters.
          </Text>

          {/* Stats row */}
          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>50+</Text>
              <Text style={styles.statLabel}>Academies</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>200+</Text>
              <Text style={styles.statLabel}>Trainers</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>5★</Text>
              <Text style={styles.statLabel}>Rated</Text>
            </View>
          </View>
        </View>

        {/* Bottom: Action buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity 
            style={styles.primaryButton} 
            onPress={() => navigation.navigate('Register')}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryButtonText}>Get Started Free →</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.secondaryButton} 
            onPress={() => navigation.navigate('Login')}
            activeOpacity={0.85}
          >
            <Text style={styles.secondaryButtonText}>Login</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.guestButton}
            onPress={() => navigation.navigate('GuestHome')}
          >
            <Text style={styles.guestButtonText}>Browse as guest</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a4d8c',  // deep blue matching your logo
    position: 'relative',
    overflow: 'hidden',
  },

  // Background decorative emojis (very subtle)
  bgEmojiTopRight: {
    position: 'absolute',
    top: -30,
    right: -40,
    fontSize: 200,
    opacity: 0.08,
    color: 'white',
  },
  bgEmojiBottomLeft: {
    position: 'absolute',
    bottom: -20,
    left: -30,
    fontSize: 150,
    opacity: 0.05,
    color: 'white',
  },
  bgEmojiMiddle: {
    position: 'absolute',
    top: SCREEN_HEIGHT * 0.45,
    right: -50,
    fontSize: 180,
    opacity: 0.04,
    color: 'white',
  },

  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 30,
    justifyContent: 'space-between',
    minHeight: SCREEN_HEIGHT,
  },

  // Logo at top
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoBox: {
    width: 44,
    height: 44,
    backgroundColor: 'white',
    borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  logoText: {
    fontSize: 24,
    fontWeight: '700',
    color: 'white',
    letterSpacing: 0.3,
  },

  // Hero content (middle)
  heroContent: {
    marginTop: 50,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    marginBottom: 16,
  },
  badgeText: {
    fontSize: 11,
    color: 'white',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  headline: {
    fontSize: 38,
    fontWeight: '700',
    color: 'white',
    lineHeight: 44,
  },
  headlineYellow: {
    color: '#ffd60a',  // yellow accent
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 20,
    marginTop: 8,
  },

  // Stats
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 16,
    marginTop: 24,
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statNumber: {
    fontSize: 22,
    fontWeight: '700',
    color: 'white',
  },
  statLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },

  // Buttons
  buttonContainer: {
    marginTop: 30,
    gap: 10,
  },
  primaryButton: {
    backgroundColor: '#e63946',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  secondaryButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  guestButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  guestButtonText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
});
