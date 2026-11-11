import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { Card, EmptyState, Skeleton } from '@/components/ui/atoms';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { QueryError } from '@/components/ui/QueryError';
import { Screen, StickyBar } from '@/components/ui/Screen';
import { ApiError } from '@/lib/api/client';
import type { ApiVendorProduct } from '@/lib/api/endpoints';
import {
  useCreateVendorProduct,
  useDeleteVendorProduct,
  useUpdateVendorProduct,
  useUploadImage,
  useVendorProducts,
} from '@/lib/api/hooks';
import { pickImages } from '@/lib/api/uploads';
import { naira } from '@/lib/format';
import { colors } from '@/lib/theme';

/** The vendor's catalogue — add, edit, hide and remove listings. */
export default function VendorListings() {
  const { data: products = [], isLoading, isError, error, refetch } = useVendorProducts();
  const [editing, setEditing] = useState<ApiVendorProduct | 'new' | null>(null);

  const update = useUpdateVendorProduct();

  return (
    <Screen>
      <View className="flex-row items-center px-4 py-3">
        <Text className="text-ink text-[24px] font-display flex-1">Listings</Text>
        <Text className="text-muted text-[13px]">{products.length} items</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="w-full h-24 mb-3" />)
        ) : isError ? (
          <QueryError error={error} onRetry={() => refetch()} noun="your listings" />
        ) : products.length ? (
          products.map((product) => (
            <Card key={product.id} className="flex-row items-center p-3 mb-3">
              {product.imageUrl ? (
                <Image
                  source={{ uri: product.imageUrl }}
                  style={{ width: 56, height: 56, borderRadius: 10 }}
                  contentFit="cover"
                />
              ) : (
                <View className="w-14 h-14 rounded-[10px] bg-surface items-center justify-center">
                  <Ionicons name="fast-food-outline" size={22} color={colors.muted} />
                </View>
              )}

              <Pressable
                onPress={() => setEditing(product)}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${product.name}`}
                className="flex-1 ml-3"
              >
                <Text className="text-ink text-[15px] font-semibold" numberOfLines={1}>
                  {product.name}
                </Text>
                <Text className="text-muted text-[13px] mt-0.5">
                  {naira(product.priceKobo / 100)}
                  {product.section ? ` · ${product.section}` : ''}
                </Text>
              </Pressable>

              {/* In-stock is the switch a vendor reaches for most — a sold-out
                  dish at 8pm should take one tap, not a form. */}
              <View className="items-center">
                <Switch
                  value={product.inStock}
                  onValueChange={(next) =>
                    update.mutate({ id: product.id, patch: { inStock: next } })
                  }
                  trackColor={{ true: colors.pink[600], false: colors.hairline }}
                  thumbColor={colors.white}
                />
                <Text className="text-muted text-[11px] mt-0.5">
                  {product.inStock ? 'In stock' : 'Sold out'}
                </Text>
              </View>
            </Card>
          ))
        ) : (
          <EmptyState
            icon="pricetags-outline"
            title="No listings yet"
            body="Add what you sell so customers can order it."
          />
        )}
      </ScrollView>

      <StickyBar>
        <Button title="Add a listing" icon="add" onPress={() => setEditing('new')} />
      </StickyBar>

      <ListingEditor
        target={editing}
        onClose={() => setEditing(null)}
      />
    </Screen>
  );
}

/** Create or edit one listing. A full-screen modal, because phones. */
function ListingEditor({
  target,
  onClose,
}: {
  target: ApiVendorProduct | 'new' | null;
  onClose: () => void;
}) {
  const isNew = target === 'new';
  const product = target === 'new' || target === null ? null : target;

  const create = useCreateVendorProduct();
  const update = useUpdateVendorProduct();
  const remove = useDeleteVendorProduct();
  const upload = useUploadImage('product-images');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  // Naira in the field, kobo on the wire — the conversion happens once, here.
  const [price, setPrice] = useState('');
  const [section, setSection] = useState('');
  /**
   * Whether this item also sits on the cross-vendor Marketplace shelf.
   *
   * On by default. The API accepted this field all along but nothing could
   * send it — not this screen, not the web portal, not the ops dashboard — so
   * the Marketplace stayed empty while vendors had catalogues sitting right
   * there. A vendor adding stock wants customers, so reaching the widest shelf
   * is the sensible default and opting out is one tap.
   */
  const [isMarketplace, setIsMarketplace] = useState(true);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [localImage, setLocalImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<string | null>(null);

  // Re-seed the form whenever a different listing is opened. Keyed on id so
  // reopening the same one does not wipe edits mid-session.
  const key = product?.id ?? (isNew ? 'new' : null);
  if (key !== ready) {
    setReady(key);
    setName(product?.name ?? '');
    setDescription(product?.description ?? '');
    setPrice(product ? String(product.priceKobo / 100) : '');
    setSection(product?.section ?? '');
    // A new listing starts listed; an existing one keeps whatever it has.
    setIsMarketplace(product?.isMarketplace ?? true);
    setImageUrl(product?.imageUrl ?? null);
    setLocalImage(null);
    setError(null);
  }

  const nairaPrice = Number(price.replace(/[^0-9]/g, ''));
  const valid = name.trim().length >= 2 && nairaPrice >= 1;
  const busy = create.isPending || update.isPending || upload.isPending;

  async function addPhoto() {
    setError(null);
    const [asset] = await pickImages(1);
    if (!asset) return;

    setLocalImage(asset.uri);
    try {
      setImageUrl(await upload.mutateAsync(asset));
    } catch {
      setLocalImage(null);
      setError('That photo could not be uploaded. Try another one.');
    }
  }

  function save() {
    setError(null);
    const body = {
      name: name.trim(),
      description: description.trim() || undefined,
      priceKobo: nairaPrice * 100,
      section: section.trim() || undefined,
      /* Always sent, never omitted: the API schema defaults it to false, so
         leaving it out of an edit would quietly delist an item every time its
         price or photo changed. */
      isMarketplace,
      ...(imageUrl ? { imageUrl } : {}),
    };

    const onError = (err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'Could not save that listing.');

    if (isNew) create.mutate(body, { onSuccess: onClose, onError });
    else if (product) update.mutate({ id: product.id, patch: body }, { onSuccess: onClose, onError });
  }

  return (
    <Modal visible={target !== null} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <View className="flex-row items-center px-4 py-3 border-b border-hairline">
          <Text className="text-ink text-[18px] font-bold flex-1">
            {isNew ? 'Add a listing' : 'Edit listing'}
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" className="p-2">
            <Ionicons name="close" size={22} color={colors.ink} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            onPress={addPhoto}
            accessibilityRole="button"
            accessibilityLabel="Add a photo"
            className="w-full h-40 rounded-lg bg-surface items-center justify-center overflow-hidden mb-4"
          >
            {localImage || imageUrl ? (
              <>
                <Image
                  source={{ uri: localImage ?? imageUrl! }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                />
                {upload.isPending ? (
                  <View className="absolute inset-0 items-center justify-center bg-ink/40">
                    <ActivityIndicator color={colors.white} />
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <Ionicons name="camera-outline" size={26} color={colors.pink[400]} />
                <Text className="text-muted text-[13px] mt-1.5">Add a photo</Text>
              </>
            )}
          </Pressable>

          <Input label="Name" value={name} onChangeText={setName} placeholder="Jollof Rice + Chicken" />
          <Input
            label="Price"
            value={price}
            onChangeText={setPrice}
            placeholder="4500"
            keyboardType="number-pad"
            prefix="₦"
          />
          <Input
            label="Description (optional)"
            value={description}
            onChangeText={setDescription}
            placeholder="What's in it, and how much it serves"
            multiline
          />
          <Input
            label="Section (optional)"
            value={section}
            onChangeText={setSection}
            placeholder="Popular, Rice & Grains, Drinks…"
            helper="Groups this with similar items on your page."
          />

          {/*
            On by default. Your shop page always shows everything you sell; the
            Marketplace is the wider shelf shoppers browse across every vendor
            at once, and a vendor adding stock is after customers. Turning it
            off is one tap, and it is the same switch and the same catalogue as
            the web portal — an item added in either place behaves the same.
          */}
          <View className="flex-row items-start mt-2">
            <View className="flex-1 pr-3">
              <Text className="text-ink text-[15px] font-semibold">Also list on Marketplace</Text>
              <Text className="text-muted text-[12.5px] mt-0.5 leading-[17px]">
                Shoppers browsing all vendors at once will see this item. It stays on your
                shop page either way.
              </Text>
            </View>
            <Switch
              value={isMarketplace}
              onValueChange={setIsMarketplace}
              accessibilityLabel="Also list on Marketplace"
              trackColor={{ false: colors.hairline, true: colors.pink[600] }}
            />
          </View>

          {error ? <Text className="text-error text-[14px] mt-1">{error}</Text> : null}

          {product ? (
            <View className="mt-8">
              <Button
                title="Delete this listing"
                variant="text"
                loading={remove.isPending}
                onPress={() => remove.mutate(product.id, { onSuccess: onClose })}
              />
              {product._count.orderItems > 0 ? (
                <Text className="text-muted text-[12px] text-center mt-1 leading-[17px]">
                  {product._count.orderItems} past order{product._count.orderItems === 1 ? '' : 's'}{' '}
                  included this. They keep the name and price you charged.
                </Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        <StickyBar>
          <Button
            title={upload.isPending ? 'Uploading photo…' : isNew ? 'Add listing' : 'Save changes'}
            disabled={!valid || upload.isPending}
            loading={busy && !upload.isPending}
            onPress={save}
          />
        </StickyBar>
      </Screen>
    </Modal>
  );
}
