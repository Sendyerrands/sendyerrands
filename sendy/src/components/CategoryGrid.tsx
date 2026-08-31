import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { CATEGORY_PALETTE, CategoryIcon } from '@/components/brand/CategoryIcons';
import { CATEGORIES, type Category } from '@/lib/mock';
import { colors } from '@/lib/theme';

/**
 * 3-across pillar grid. Marketplace carries the `New` ribbon because Vendor
 * Marketplace V1 is the Phase-1 differentiator (design.md §11).
 *
 * Three rather than the original four: with Logistics moved inside Packages
 * and Pharmacy gone, six tiles across four columns left an orphaned row of
 * two. Three gives two full rows and a larger tap target.
 */
export function CategoryGrid() {
  const router = useRouter();

  return (
    <View className="flex-row flex-wrap px-4">
      {CATEGORIES.map((cat) => (
        <CategoryTile
          key={cat.slug}
          category={cat}
          onPress={
            // A coming-soon tile gets no handler at all, rather than a handler
            // that navigates somewhere empty. Passing undefined is what makes
            // the Pressable inert and drops it out of the tab order.
            cat.comingSoon
              ? undefined
              : () =>
                  cat.href
                    ? router.push(cat.href as never)
                    : router.push({ pathname: '/category/[slug]', params: { slug: cat.slug } })
          }
        />
      ))}
    </View>
  );
}

function CategoryTile({ category, onPress }: { category: Category; onPress?: () => void }) {
  const soon = Boolean(category.comingSoon);

  return (
    <Pressable
      onPress={onPress}
      disabled={soon}
      // Announced as plain text rather than a button, so a screen reader does
      // not offer to activate something that does nothing. The label carries
      // the status, which is otherwise only visible as colour.
      accessibilityRole={soon ? 'text' : 'button'}
      accessibilityLabel={soon ? `${category.label} — coming soon` : category.label}
      className="w-1/3 items-center mb-4 px-1.5"
    >
      <View
        className="w-full aspect-square rounded-xl items-center justify-center relative overflow-hidden"
        style={{
          backgroundColor: soon
            ? colors.surface
            : (CATEGORY_PALETTE[category.slug] ?? CATEGORY_PALETTE.packages!).tint,
        }}
      >
        {/* Scaled with the tile — at three across each square is roughly a
            third wider than it was, and a 30px glyph read as lost in it. */}
        <CategoryIcon slug={category.slug} size={36} muted={soon} />
        {category.badge && !soon ? (
          <View className="absolute top-0 right-0 bg-savings px-1.5 py-0.5 rounded-bl-md">
            <Text className="text-white text-[9px] font-bold tracking-wide">{category.badge}</Text>
          </View>
        ) : null}
      </View>
      <Text
        className={`text-[13px] font-semibold mt-2 text-center ${soon ? 'text-muted' : 'text-ink'}`}
        numberOfLines={1}
      >
        {category.label}
      </Text>
      {/* For a coming-soon tile this is what stops grey reading as "broken" —
          without it the tile is just a dimmer version of the working ones.
          `caption` stays supported for any tile that needs disambiguating; no
          tile currently does, since Logistics moved inside Packages. */}
      {soon || category.caption ? (
        <Text className="text-muted text-[10px] text-center mt-0.5" numberOfLines={1}>
          {soon ? 'Coming soon' : category.caption}
        </Text>
      ) : null}
    </Pressable>
  );
}
