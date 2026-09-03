import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { apiGet } from "@/services/api";
import { errorText } from "@/services/errors";
import { useAuthStore } from "@/store/useAuthStore";
import { routes } from "@/types/navigation";
import { teacherStyles as shared, teacherColors as colors } from "@/screens/teacher/styles";

export interface ChatChannel {
  id: string;
  kind: "class_chat" | "ai_assistant";
  title: string;
  class_id: string | null;
  member_count: number;
  unread: number;
  last_message_at: string | null;
  last_message_preview: string | null;
}

interface ChannelListResponse {
  channels: ChatChannel[];
  empty_reason: "no_channels" | null;
}

export function ChatChannelsScreen() {
  const me = useAuthStore((state) => state.me);
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiGet<ChannelListResponse>("/v1/channels")
      .then((response) =>
        setChannels(response.channels.filter((channel) => channel.kind === "class_chat")),
      )
      .catch((e: unknown) => setError(errorText(e, "Не удалось загрузить чаты")))
      .finally(() => setIsLoading(false));
  }, []);

  useFocusEffect(useCallback(() => load(), [load]));

  return (
    <SafeAreaView style={shared.safeArea} edges={["top"]}>
      <View style={shared.root}>
        <View style={shared.header}>
          <View>
            <Text style={shared.logo}>Tlek</Text>
            <Text style={shared.headerSubtitle}>Чат</Text>
          </View>
          <Pressable
            accessibilityLabel="Личный кабинет"
            accessibilityRole="button"
            onPress={() => router.push(routes.personalAccount)}
            style={({ pressed }) => [shared.avatarButton, pressed && shared.pressed]}
          >
            <Avatar uri={me?.avatar_url} name={me?.display_name} size={34} />
          </Pressable>
        </View>

        <ScrollView
          style={shared.scroll}
          contentContainerStyle={shared.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={shared.titleBlock}>
            <Text style={shared.title}>Чаты классов</Text>
            <Text style={shared.subtitle}>
              Переписка с классом. Уроки приходят отдельным каналом — в чат они не попадают.
            </Text>
          </View>

          {error ? <Text style={shared.errorText}>{error}</Text> : null}
          {isLoading ? <ActivityIndicator color={colors.blue} style={{ marginTop: 12 }} /> : null}

          {!isLoading && channels.length === 0 ? (
            <Text style={shared.emptyText}>
              Чатов пока нет. Канал заводится вместе с классом.
            </Text>
          ) : null}

          <View style={shared.list}>
            {channels.map((channel) => (
              <Pressable
                key={channel.id}
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: "/chat-channel",
                    params: { channelId: channel.id, title: channel.title },
                  })
                }
                style={({ pressed }) => [shared.card, pressed && shared.pressed]}
              >
                <View style={styles.row}>
                  <View style={styles.copy}>
                    <Text style={shared.cardTitle}>{channel.title}</Text>
                    <Text style={shared.cardMeta} numberOfLines={1}>
                      {channel.last_message_preview ?? "Сообщений пока нет"}
                    </Text>
                  </View>
                  {channel.unread > 0 ? (
                    <View style={styles.unread}>
                      <Text style={styles.unreadText}>{channel.unread}</Text>
                    </View>
                  ) : null}
                  <Ionicons name="chevron-forward" size={20} color={colors.muted} />
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  copy: { flex: 1 },
  unread: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.navy,
    paddingHorizontal: 7,
  },
  unreadText: { color: "#ffffff", fontSize: 12, fontWeight: "900" },
});
