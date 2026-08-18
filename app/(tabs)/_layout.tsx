import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#1f6feb",
        tabBarInactiveTintColor: "#667085"
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" color={color} size={size} />
        }}
      />
      <Tabs.Screen
        name="learning"
        options={{
          title: "Learning",
          tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" color={color} size={size} />
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: "Progress",
          tabBarIcon: ({ color, size }) => <Ionicons name="analytics-outline" color={color} size={size} />
        }}
      />
    </Tabs>
  );
}
