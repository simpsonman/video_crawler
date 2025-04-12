<template>
  <div class="downloader-container">
    <el-tabs v-model="activeTab" class="custom-tabs">
      <el-tab-pane label="YouTube" name="youtube">
        <youtube-downloader />
      </el-tab-pane>
      <!-- <el-tab-pane label="Instagram" name="instagram">
        <instagram-downloader />
      </el-tab-pane> -->
      <!-- <el-tab-pane label="X (Twitter)" name="twitter">
        <twitter-downloader />
      </el-tab-pane> -->
    </el-tabs>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import YoutubeDownloader from './YoutubeDownloader.vue'
import InstagramDownloader from './InstagramDownloader.vue'
import TwitterDownloader from './TwitterDownloader.vue'

const activeTab = ref('youtube')
</script>

<style scoped>
.downloader-container {
  background: white;
  border-radius: 1rem;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
  padding: 2rem;
}

.custom-tabs :deep(.el-tabs__nav-wrap) {
  padding: 0 1rem;
}

.custom-tabs :deep(.el-tabs__item) {
  font-size: 1.1rem;
  padding: 0 2rem;
}

.coming-soon {
  text-align: center;
  padding: 4rem 0;
  color: #666;
  font-size: 1.1rem;
}
</style>
