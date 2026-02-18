import React from "react";
import { View, StyleSheet } from "react-native";
import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from "@expo/vector-icons";
import Colors from "@/constants/colors";

interface PlatformBadgeProps {
  platform: string;
  size?: number;
}

const platformConfig: Record<string, { icon: string; family: string; color: string }> = {
  twitch: { icon: "twitch", family: "fontawesome5", color: Colors.dark.twitch },
  youtube: { icon: "youtube", family: "fontawesome5", color: Colors.dark.youtube },
  kick: { icon: "lightning-bolt", family: "material", color: Colors.dark.kick },
  facebook: { icon: "facebook", family: "fontawesome5", color: Colors.dark.facebook },
  tiktok: { icon: "musical-notes", family: "ionicons", color: Colors.dark.tiktok },
  other: { icon: "chatbubbles", family: "ionicons", color: Colors.dark.primary },
};

export default function PlatformBadge({ platform, size = 16 }: PlatformBadgeProps) {
  const config = platformConfig[platform] || platformConfig.other;

  const renderIcon = () => {
    if (config.family === "fontawesome5") {
      return <FontAwesome5 name={config.icon as any} size={size} color={config.color} />;
    }
    if (config.family === "material") {
      return <MaterialCommunityIcons name={config.icon as any} size={size} color={config.color} />;
    }
    return <Ionicons name={config.icon as any} size={size} color={config.color} />;
  };

  return (
    <View style={[styles.badge, { backgroundColor: config.color + "20" }]}>
      {renderIcon()}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
});
