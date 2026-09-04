import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { router, Tabs } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { routes } from "@/types/navigation";

const tabConfig: Record<
  string,
  {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
  }
> = {
  dashboard: {
    label: "Панель",
    icon: "grid"
  },
  learning: {
    label: "Обучение",
    icon: "book-outline"
  },
  progress: {
    label: "Прогресс",
    icon: "git-compare-outline"
  },
  chat: {
    label: "Чат",
    icon: "chatbubbles-outline"
  }
};

const HIDDEN_TABS = new Set(["assistant"]);

export default function TabsLayout() {
  return (
    <View style={styles.root}>
      <Tabs
        tabBar={(props) => <AppTabBar {...props} />}
        screenOptions={{
          headerShown: false
        }}
      >
        <Tabs.Screen name="dashboard" options={{ title: "Панель" }} />
        <Tabs.Screen name="learning" options={{ title: "Обучение" }} />
        <Tabs.Screen name="progress" options={{ title: "Прогресс" }} />
        <Tabs.Screen name="chat" options={{ title: "Чат" }} />
        <Tabs.Screen name="assistant" options={{ title: "Ассистент" }} />
      </Tabs>
      <AssistantDock />
    </View>
  );
}

function AssistantDock() {
  const insets = useSafeAreaInsets();
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="ИИ-ассистент"
        onPress={() => setIsOpen(true)}
        style={({ pressed }) => [
          styles.dockHandle,
          { bottom: 96 + insets.bottom },
          pressed && styles.pressed
        ]}
      >
        <Ionicons name="sparkles-outline" size={22} color="#ffffff" />
      </Pressable>
    );
  }

  return (
    <View style={styles.dockLayer}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Закрыть панель"
        onPress={() => setIsOpen(false)}
        style={styles.dockBackdrop}
      />
      <View style={[styles.dockPanel, { bottom: 84 + insets.bottom }]}>
        <View style={styles.dockHeader}>
          <Ionicons name="sparkles" size={20} color={colors.active} />
          <Text style={styles.dockTitle}>ИИ-ассистент</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Свернуть"
            onPress={() => setIsOpen(false)}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Ionicons name="close" size={22} color={colors.inactive} />
          </Pressable>
        </View>

        <Text style={styles.dockHint}>
          Разберёт тему, подскажет по домашнему заданию и объяснит непонятное.
        </Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setIsOpen(false);
            router.push(routes.assistant);
          }}
          style={({ pressed }) => [styles.dockButton, pressed && styles.pressed]}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={18} color="#ffffff" />
          <Text style={styles.dockButtonText}>Открыть ИИ-ассистента</Text>
        </Pressable>
      </View>
    </View>
  );
}

function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 8);

  return (
    <View style={[styles.tabBar, { paddingBottom: bottomPadding, minHeight: 70 + bottomPadding }]}>
      {state.routes.map((route, index) => {
        if (HIDDEN_TABS.has(route.name)) return null;

        const focused = state.index === index;
        const config = tabConfig[route.name];
        const options = descriptors[route.key]?.options;
        const label =
          config?.label ??
          (typeof options?.tabBarLabel === "string" ? options.tabBarLabel : undefined) ??
          options?.title ??
          route.name;

        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true
          });

          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={options?.tabBarAccessibilityLabel}
            onPress={onPress}
            style={({ pressed }) => [styles.tabItem, pressed && styles.pressed]}
          >
            <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
              <Ionicons
                name={config?.icon ?? "ellipse-outline"}
                size={22}
                color={focused ? "#ffffff" : colors.inactive}
              />
            </View>
            <Text style={[styles.tabLabel, focused && styles.tabLabelActive]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const colors = {
  background: "#fbfaf9",
  border: "#c5cede",
  active: "#274779",
  inactive: "#5b606b"
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  dockHandle: {
    position: "absolute",
    right: 0,
    width: 44,
    height: 52,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
    backgroundColor: colors.active,
    alignItems: "center",
    justifyContent: "center"
  },
  dockLayer: {
    ...StyleSheet.absoluteFillObject
  },
  dockBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.22)"
  },
  dockPanel: {
    position: "absolute",
    right: 12,
    left: 12,
    maxWidth: 360,
    alignSelf: "flex-end",
    borderRadius: 14,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#ffffff",
    padding: 16,
    gap: 12
  },
  dockHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  dockTitle: { flex: 1, color: colors.active, fontSize: 17, fontWeight: "900" },
  dockHint: { color: colors.inactive, fontSize: 14, lineHeight: 20 },
  dockButton: {
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: colors.active,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  dockButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "800" },
  tabBar: {
    width: "100%",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    backgroundColor: colors.background,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingTop: 8,
    paddingHorizontal: 12
  },
  tabItem: {
    flex: 1,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    gap: 3
  },
  iconWrap: {
    minWidth: 52,
    height: 30,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center"
  },
  iconWrapActive: {
    backgroundColor: colors.active
  },
  tabLabel: {
    color: colors.inactive,
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 14,
    textAlign: "center"
  },
  tabLabelActive: {
    color: colors.active,
    fontWeight: "700"
  },
  pressed: {
    opacity: 0.72
  }
});
