<template>
  <div class="youtube-downloader">
    <h2>YouTube 비디오 다운로더</h2>

    <div class="input-container">
      <el-input
        v-model="url"
        placeholder="YouTube URL을 입력해주세요"
        :disabled="loading"
        size="large"
        clearable
      >
        <template #prefix>
          <el-icon><VideoCamera /></el-icon>
        </template>
      </el-input>

      <el-button type="primary" @click="getVideoInfo" :loading="loading" size="large">
        정보 가져오기
      </el-button>
    </div>

    <!-- 비디오 정보 표시 -->
    <div v-if="videoInfo" class="video-info">
      <h3>{{ videoInfo.title }}</h3>
      <img :src="videoInfo.thumbnail" alt="썸네일" class="thumbnail" />

      <div class="format-selector">
        <el-select v-model="selectedFormat" placeholder="해상도 선택" size="large">
          <el-option
            v-for="format in videoInfo.formats"
            :key="format.itag"
            :label="`${format.quality} (${format.fps}fps)${!format.hasAudio ? ' - 비디오만' : ''}`"
            :value="format.itag"
          />
        </el-select>

        <el-button type="success" @click="handleDownload" :loading="downloading" size="large">
          다운로드
        </el-button>
      </div>
    </div>

    <div v-if="error" class="error-message">
      {{ error }}
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { VideoCamera } from '@element-plus/icons-vue'
import axios from 'axios'

const url = ref('')
const loading = ref(false)
const downloading = ref(false)
const error = ref('')
const videoInfo = ref(null)
const selectedFormat = ref(null)

const getVideoInfo = async () => {
  if (!url.value) {
    error.value = 'URL을 입력해주세요'
    return
  }

  loading.value = true
  error.value = ''

  try {
    const response = await axios.post('/api/youtube/info', { url: url.value })
    videoInfo.value = response.data
    selectedFormat.value = videoInfo.value.formats[0]?.itag // 최고 품질 기본 선택
  } catch (err) {
    console.error('Error:', err)
    error.value = '비디오 정보를 가져오는데 실패했습니다'
  } finally {
    loading.value = false
  }
}

const handleDownload = async () => {
  if (!selectedFormat.value) {
    error.value = '해상도를 선택해주세요'
    return
  }

  downloading.value = true
  error.value = ''

  try {
    const response = await axios.post(
      '/api/download/youtube',
      {
        url: url.value,
        itag: selectedFormat.value,
      },
      {
        responseType: 'blob',
      },
    )

    const blob = new Blob([response.data], { type: 'video/mp4' })
    const downloadUrl = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = `${videoInfo.value.title}.mp4`
    document.body.appendChild(link)
    link.click()
    window.URL.revokeObjectURL(downloadUrl)
    document.body.removeChild(link)
  } catch (err) {
    console.error('Download error:', err)
    error.value = '다운로드 중 오류가 발생했습니다'
  } finally {
    downloading.value = false
  }
}
</script>

<style scoped>
.youtube-downloader {
  padding: 2rem 1rem;
}

h2 {
  font-size: 1.5rem;
  color: #2c3e50;
  margin-bottom: 2rem;
  text-align: center;
}

.input-container {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
}

.video-info {
  margin-top: 2rem;
  text-align: center;
}

.thumbnail {
  max-width: 320px;
  margin: 1rem auto;
  border-radius: 8px;
}

.format-selector {
  display: flex;
  gap: 1rem;
  justify-content: center;
  margin-top: 1rem;
}

.error-message {
  color: #f56c6c;
  text-align: center;
  margin-top: 1rem;
}

:deep(.el-input__wrapper) {
  padding-right: 1rem;
}

:deep(.el-input__prefix) {
  margin-right: 0.5rem;
}
</style>
