import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { apiDelete, apiGet, apiPost } from "@/services/api";
import { errorText } from "@/services/errors";
import { teacherStyles as shared, teacherColors as colors } from "@/screens/teacher/styles";
import type { TeacherClass } from "@/screens/teacher/TeacherClassesScreen";

interface ClassMember {
  student_id: string;
  public_id: string;
  display_name: string;
  grade: number | null;
  joined_at: string;
}

interface MembersResponse {
  class: TeacherClass;
  members: ClassMember[];
  empty_reason: "no_members" | null;
}

export function ClassMembersScreen() {
  const params = useLocalSearchParams<{ classId?: string }>();
  const classId = params.classId ?? "";

  const [data, setData] = useState<MembersResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publicId, setPublicId] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const load = useCallback(() => {
    if (classId === "") return;
    setError(null);
    apiGet<MembersResponse>(`/v1/classes/${classId}/members`)
      .then(setData)
      .catch((e: unknown) =>
        setError(errorText(e, "Не удалось загрузить состав класса")),
      )
      .finally(() => setIsLoading(false));
  }, [classId]);

  useEffect(load, [load]);

  const addMember = () => {
    const code = publicId.trim();
    if (code === "" || isAdding) return;

    setIsAdding(true);
    setError(null);
    apiPost(`/v1/classes/${classId}/members`, { public_id: code })
      .then(() => {
        setPublicId("");
        load();
      })
      .catch((e: unknown) =>
        setError(errorText(e, "Не удалось добавить ученика")),
      )
      .finally(() => setIsAdding(false));
  };

  const removeMember = (studentId: string) => {
    apiDelete(`/v1/classes/${classId}/members/${studentId}`)
      .then(() => load())
      .catch((e: unknown) =>
        setError(errorText(e, "Не удалось исключить ученика")),
      );
  };

  const channelId = data?.class.chat_channel_id ?? null;

  return (
    <SafeAreaView style={shared.safeArea} edges={["top"]}>
      <View style={shared.root}>
        <View style={shared.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Назад" onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {data?.class.name ?? "Класс"}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          style={shared.scroll}
          contentContainerStyle={shared.content}
          showsVerticalScrollIndicator={false}
        >
          {error ? <Text style={shared.errorText}>{error}</Text> : null}
          {isLoading ? <ActivityIndicator color={colors.blue} /> : null}

          <View style={shared.card}>
            <Text style={shared.cardTitle}>Добавить ученика</Text>
            <Text style={shared.cardMeta}>
              Код вида TLK-XXXXXXXX — ученик находит его в своём профиле.
            </Text>
            <TextInput
              value={publicId}
              onChangeText={setPublicId}
              placeholder="TLK-XXXXXXXX"
              autoCapitalize="characters"
              autoCorrect={false}
              style={shared.input}
            />
            <Pressable
              accessibilityRole="button"
              disabled={publicId.trim() === "" || isAdding}
              onPress={addMember}
              style={({ pressed }) => [
                shared.primaryButton,
                styles.addAction,
                (publicId.trim() === "" || isAdding) && shared.disabled,
                pressed && shared.pressed,
              ]}
            >
              <Text style={shared.primaryButtonText}>Добавить</Text>
            </Pressable>
          </View>

          {channelId === null ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: "/chat-channel",
                  params: { channelId, title: data?.class.name ?? "Чат класса" },
                })
              }
              style={({ pressed }) => [shared.card, styles.chatLink, pressed && shared.pressed]}
            >
              <Ionicons name="chatbubbles-outline" size={22} color={colors.navy} />
              <View style={styles.chatCopy}>
                <Text style={shared.cardTitle}>Чат класса</Text>
                <Text style={shared.cardMeta}>Переписка с учениками, отдельно от рассылки уроков.</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </Pressable>
          )}

          <Text style={styles.sectionTitle}>
            Ученики{data === null ? "" : ` · ${data.members.length}`}
          </Text>

          {data !== null && data.members.length === 0 ? (
            <Text style={shared.emptyText}>
              В классе пока никого нет. Попросите учеников продиктовать код из профиля.
            </Text>
          ) : null}

          <View style={shared.list}>
            {data?.members.map((member) => (
              <View key={member.student_id} style={shared.card}>
                <View style={styles.memberRow}>
                  <View style={styles.memberCopy}>
                    <Text style={shared.cardTitle}>{member.display_name}</Text>
                    <Text style={shared.cardMeta}>
                      {member.public_id}
                      {member.grade === null ? "" : ` · ${member.grade} класс`}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Исключить ${member.display_name}`}
                    onPress={() => removeMember(member.student_id)}
                    hitSlop={8}
                  >
                    <Text style={styles.removeAction}>Исключить</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  headerSpacer: { width: 26 },
  addAction: { marginTop: 14, alignSelf: "flex-start" },
  chatLink: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16 },
  chatCopy: { flex: 1 },
  sectionTitle: {
    marginTop: 26,
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  memberRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  memberCopy: { flex: 1 },
  removeAction: { color: "#c31717", fontSize: 13, fontWeight: "800" },
});
