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

        <div v-if="showCancelButton" class="action-buttons">
          <el-button type="danger" @click="onCancel">Cancel</el-button>
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
  showCancelButton: {
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
  height: 10px;
  background-color: #ebeef5;
  border-radius: 5px;
  margin: 16px 0 8px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background-color: #409eff;
  transition: width 0.3s ease;
}

.progress-text {
  text-align: right;
  font-size: 12px;
  color: #909399;
  margin-bottom: 16px;
}

.action-buttons {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.ad-container {
  padding: 16px;
  background-color: #f5f7fa;
  border-top: 1px solid #ebeef5;
}

.ad-placeholder {
  height: 100px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  border: 1px dashed #dcdfe6;
  border-radius: 4px;
  background-color: white;
  color: #909399;
}

.ad-info {
  font-size: 12px;
  margin-top: 8px;
  color: #c0c4cc;
}
</style>
