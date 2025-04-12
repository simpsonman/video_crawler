<template>
  <div v-if="visible" class="loading-popup-overlay">
    <div class="loading-popup">
      <div class="loading-content">
        <h3>{{ title }}</h3>
        <p>{{ message }}</p>

        <div class="progress-container">
          <div class="progress-bar" :style="{ width: `${progress}%` }"></div>
        </div>
        <div class="progress-text">{{ progress }}%</div>

        <div v-if="speedInfo || etaInfo" class="download-info">
          <div v-if="speedInfo" class="speed-info">
            <span>Speed: {{ speedInfo }}</span>
          </div>
          <div v-if="etaInfo" class="eta-info">
            <span>ETA: {{ etaInfo }}</span>
          </div>
        </div>

        <div v-if="cancelable" class="action-buttons">
          <button @click="onCancel" class="cancel-button">Cancel</button>
        </div>
      </div>

      <!-- 광고 영역 -->
      <div class="ad-container">
        <div class="ad-placeholder">
          <p>Advertisement area</p>
          <p class="ad-info">Remove ads by subscribing to the premium</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: 'Processing...',
  },
  message: {
    type: String,
    default: 'Please wait a moment',
  },
  progress: {
    type: Number,
    default: 0,
  },
  speedInfo: {
    type: String,
    default: '',
  },
  etaInfo: {
    type: String,
    default: '',
  },
  cancelable: {
    type: Boolean,
    default: true,
  },
})

const emit = defineEmits(['cancel'])

const onCancel = () => {
  emit('cancel')
}
</script>

<style scoped>
.loading-popup-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
}

.loading-popup {
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  width: 90%;
  max-width: 500px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.loading-content {
  padding: 24px;
}

h3 {
  margin-top: 0;
  color: #303133;
}

p {
  color: #606266;
}

.progress-container {
  margin-top: 16px;
  height: 8px;
  background-color: #e4e7ed;
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background-color: #409eff;
  transition: width 0.3s ease;
}

.progress-text {
  margin-top: 8px;
  text-align: right;
  font-size: 14px;
  color: #606266;
}

.download-info {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 14px;
  color: #606266;
}

.action-buttons {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

.cancel-button {
  padding: 8px 16px;
  background-color: #f56c6c;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.cancel-button:hover {
  background-color: #e64242;
}

.ad-container {
  background-color: #f5f7fa;
  padding: 16px;
  text-align: center;
  border-top: 1px solid #e4e7ed;
}

.ad-placeholder {
  height: 90px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  color: #909399;
}

.ad-info {
  font-size: 12px;
  margin-top: 8px;
  color: #c0c4cc;
}
</style>
