import { Image } from 'expo-image';
import { Text, View } from 'react-native';

/**
 * Sendy Rides — announced, not yet built.
 *
 * Sits under the pillar grid rather than in the carousel above it. The carousel
 * rotates, so a slide there is seen for a few seconds by whoever happens to be
 * looking; this is the one thing on the home screen that is being announced
 * rather than sold, and it should hold still.
 *
 * Nothing here is pressable. A tappable "coming soon" is the dead control this
 * app keeps being bitten by — the Bills tile was exactly that, and it was moved
 * to the carousel for the same reason. A banner may say "not yet"; a button may
 * not.
 */
export function RidesBanner() {
  return (
    <View className="mx-4">
      <View
        // Announced to a screen reader as one piece of text, since the artwork
        // carries no information the copy does not already give.
        accessible
        accessibilityRole="text"
        accessibilityLabel="Sendy Rides. Book rides and travel with Sendy. Coming soon."
        className="rounded-xl overflow-hidden bg-pink-50"
      >
        <View className="px-4 pt-4 pb-1">
          <View className="self-start rounded-full bg-pink-600 px-2.5 py-1">
            <Text className="text-white text-[10.5px] font-bold tracking-wide">COMING SOON</Text>
          </View>

          <Text className="text-ink text-[21px] font-display mt-2.5 leading-[26px]">
            Sendy Rides
          </Text>
          <Text className="text-body text-[14px] mt-1 leading-[20px]">
            Book rides and travel with Sendy.
          </Text>
        </View>

        {/*
          contentFit="contain" on a fixed-ratio box: the artwork is a cut-out
          with its own transparent margin, so cropping it to fill would slice
          the car. The box keeps its height whatever the screen width, which is
          what stops the banner collapsing on a narrow phone.
        */}
        <Image
          source={require('../../assets/images/sendy-rides.png')}
          style={{ width: '100%', aspectRatio: 577 / 433, marginTop: -4 }}
          contentFit="contain"
          transition={200}
          accessible={false}
        />
      </View>
    </View>
  );
}
