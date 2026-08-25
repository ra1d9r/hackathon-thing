import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Tabs } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
    icon: "help-buoy-outline"
  },
  progress: {
    label: "Прогресс",
    icon: "git-compare-outline"
  }
};

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{
        headerShown: false
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: "Панель" }} />
      <Tabs.Screen name="learning" options={{ title: "Обучение" }} />
      <Tabs.Screen name="progress" options={{ title: "Прогресс" }} />
    </Tabs>
  );
}

function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 8);

  return (
    <View style={[styles.tabBar, { paddingBottom: bottomPadding, minHeight: 70 + bottomPadding }]}>
      {state.routes.map((route, index) => {
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
