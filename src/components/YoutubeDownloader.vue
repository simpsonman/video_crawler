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

      <el-button type="primary" @click="handleDownload" :loading="loading" size="large">
        다운로드
      </el-button>
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
const error = ref('')

const API_URL = import.meta.env.PROD
  ? '/api/download/youtube' // 프로덕션
  : 'http://localhost:5000/api/download/youtube' // 개발

const handleDownload = async () => {
  if (!url.value) {
    error.value = 'URL을 입력해주세요'
    return
  }

  loading.value = true
  error.value = ''

  try {
    const response = await axios.post(
      API_URL,
      { url: url.value },
      {
        responseType: 'blob',
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )

    // 에러 응답 체크
    if (response.data instanceof Blob && response.data.type === 'application/json') {
      const text = await response.data.text()
      const json = JSON.parse(text)
      throw new Error(json.error || '다운로드 중 오류가 발생했습니다')
    }

    const blob = new Blob([response.data], { type: 'video/mp4' })
    const downloadUrl = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = `youtube-video-${Date.now()}.mp4`
    document.body.appendChild(link)
    link.click()
    window.URL.revokeObjectURL(downloadUrl)
    document.body.removeChild(link)

    url.value = ''
  } catch (err) {
    console.error('Download error:', err)
    if (err.response) {
      console.error('Error response:', err.response.data)
      error.value = err.response.data.error || '다운로드 중 오류가 발생했습니다'
    } else if (err.request) {
      error.value = '서버에 연결할 수 없습니다'
    } else {
      error.value = err.message
    }
  } finally {
    loading.value = false
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
