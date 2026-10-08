<script setup lang="ts">
// A person's avatar rendered as a star: custom photo when provided, otherwise a glowing star core.
defineProps<{
  name: string;
  avatarUrl: string | null;
  tone: "gold" | "aqua" | "fog";
  size?: "sm" | "md" | "lg" | "xl";
}>();
</script>

<template>
  <span class="star-avatar" :class="[`tone-${tone}`, `size-${size ?? 'md'}`]">
    <span class="star-avatar-halo" aria-hidden="true"></span>
    <span class="star-avatar-ring" aria-hidden="true"></span>
    <span class="star-avatar-flare" aria-hidden="true"></span>
    <span class="star-avatar-core">
      <img v-if="avatarUrl" :src="avatarUrl" :alt="`${name}的头像`" loading="lazy" />
      <svg v-else class="star-avatar-glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 1.5c.5 5.6 4.9 10 10.5 10.5-5.6.5-10 4.9-10.5 10.5-.5-5.6-4.9-10-10.5-10.5C7.1 11.5 11.5 7.1 12 1.5Z" />
      </svg>
    </span>
  </span>
</template>
