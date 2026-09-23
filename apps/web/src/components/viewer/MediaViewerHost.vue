<script setup lang="ts">
/**
 * Renders whatever the media viewer's slot holds (`media-viewer.ts`); mounted
 * once from App.vue beside the other dialog hosts, so something opened from a
 * chat window floats above the whole desktop rather than inside it.
 *
 * One host and one `v-if` chain, so a picture and a video can never be on
 * screen at the same time — that is the whole reason the slot is a union rather
 * than two refs (see media-viewer.ts).
 *
 * Keyed by the address: opening another picture while one is shown starts the
 * viewer again, fitted, instead of inheriting the previous picture's zoom, and
 * another video starts paused at its own first frame rather than inheriting a
 * playhead.
 */
import { closeMediaViewer, viewedMedia } from "./media-viewer";
import PictureViewer from "./PictureViewer.vue";
import VideoViewer from "./VideoViewer.vue";
</script>

<template>
  <PictureViewer
    v-if="viewedMedia?.kind === 'picture'"
    :key="viewedMedia.url"
    :url="viewedMedia.url"
    :name="viewedMedia.name"
    @close="closeMediaViewer"
  />
  <VideoViewer
    v-else-if="viewedMedia?.kind === 'video'"
    :key="viewedMedia.url"
    :url="viewedMedia.url"
    :name="viewedMedia.name"
    @close="closeMediaViewer"
  />
</template>
