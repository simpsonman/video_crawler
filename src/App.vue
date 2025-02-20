<script setup>
import { RouterLink, RouterView } from 'vue-router'
import HelloWorld from './components/HelloWorld.vue'
import DownloaderTabs from './components/DownloaderTabs.vue'
</script>

<template>
  <div class="app">
    <header>
      <h1>SNS 비디오 다운로더</h1>
    </header>
    <main>
      <downloader-tabs />
    </main>
  </div>
</template>

<style>
.app {
  min-height: 100vh;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
}

header {
  padding: 3rem 0;
  text-align: center;
}

header h1 {
  font-size: 2.5rem;
  font-weight: 700;
  color: #2c3e50;
  margin: 0;
}

main {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 2rem;
}
</style>
