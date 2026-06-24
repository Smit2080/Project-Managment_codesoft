import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Send, Paperclip, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import API from '../lib/api';
import toast from 'react-hot-toast';

const priorityColors = {
  urgent: 'text-red-600 bg-red-100',
  high: 'text-orange-600 bg-orange-100',
  medium: 'text-yellow-600 bg-yellow-100',
  low: 'text-gray-500 bg-gray-100',
};

const statusColors = {
  todo: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  in_review: 'bg-amber-100 text-amber-700',
  done: 'bg-green-100 text-green-700',
};

export default function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [uploading, setUploading] = useState(false);

  const { data: task, isLoading } = useQuery({
    queryKey: ['task', id],
    queryFn: () => API.get(`/tasks/${id}`).then(r => r.data),
  });

  const updateMutation = useMutation({
    mutationFn: (data) => API.put(`/tasks/${id}`, data).then(r => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['task', id] });
      toast.success('Task updated');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Update failed'),
  });

  const commentMutation = useMutation({
    mutationFn: (content) => API.post(`/tasks/${id}/comments`, { content }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', id] });
      setComment('');
      toast.success('Comment added');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to add comment'),
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: (attId) => API.delete(`/tasks/attachments/${attId}`).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', id] });
      toast.success('Attachment removed');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to remove'),
  });

  const handleDownload = async (att) => {
    try {
      const res = await API.get(`/tasks/attachments/${att.id}/download`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.filename;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Download failed');
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      await API.post(`/tasks/${id}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      queryClient.invalidateQueries({ queryKey: ['task', id] });
      toast.success('File uploaded');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        <div className="h-40 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  if (!task) {
    return <div className="text-center py-10 text-gray-400">Task not found</div>;
  }

  return (
    <div>
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors duration-150">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <div className="flex items-start justify-between mb-6">
          <div className="flex-1">
            <h1 className="text-2xl font-bold mb-2">{task.title}</h1>
            {task.description && <p className="text-gray-600">{task.description}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="block text-xs font-medium text-gray-500 mb-2">Status</label>
            <select
              value={task.status}
              onChange={(e) => updateMutation.mutate({ status: e.target.value })}
              className="input-field text-sm"
            >
              <option value="todo">To Do</option>
              <option value="in_progress">In Progress</option>
              <option value="in_review">In Review</option>
              <option value="done">Done</option>
            </select>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="block text-xs font-medium text-gray-500 mb-2">Priority</label>
            <select
              value={task.priority}
              onChange={(e) => updateMutation.mutate({ priority: e.target.value })}
              className="input-field text-sm"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="block text-xs font-medium text-gray-500 mb-2">Assignee</label>
            <p className="text-sm text-gray-700">
              {task.assignee ? task.assignee.displayName : 'Unassigned'}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="block text-xs font-medium text-gray-500 mb-2">Due Date</label>
            <p className="text-sm text-gray-700">
              {task.dueDate ? format(new Date(task.dueDate), 'MMM d, yyyy') : 'No due date'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold mb-4">Comments ({task.comments?.length || 0})</h3>
              <div className="space-y-4 mb-4">
                {(task.comments || []).map((c) => (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                    className="flex gap-3"
                  >
                    <div className="w-8 h-8 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0">
                      {c.user?.displayName?.[0] || '?'}
                    </div>
                    <div className="flex-1 bg-gray-50 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium">{c.user?.displayName}</span>
                        <span className="text-xs text-gray-400">{format(new Date(c.createdAt), 'MMM d, h:mm a')}</span>
                      </div>
                      <p className="text-sm text-gray-700">{c.content}</p>
                    </div>
                  </motion.div>
                ))}
                {(!task.comments || task.comments.length === 0) && (
                  <p className="text-sm text-gray-400 text-center py-4">No comments yet</p>
                )}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (comment.trim()) commentMutation.mutate(comment.trim());
                }}
                className="flex gap-2"
              >
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Write a comment..."
                  className="input-field flex-1"
                />
                <button type="submit" disabled={!comment.trim() || commentMutation.isPending} className="btn-primary flex items-center gap-1.5">
                  <Send className="w-4 h-4" /> Send
                </button>
              </form>
            </div>
          </div>

          <div>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold mb-4 flex items-center justify-between">
                Attachments ({task.attachments?.length || 0})
                <label className="btn-secondary text-xs cursor-pointer flex items-center gap-1">
                  <Paperclip className="w-3 h-3" />
                  {uploading ? 'Uploading...' : 'Upload'}
                  <input type="file" onChange={handleFileUpload} className="hidden" disabled={uploading} />
                </label>
              </h3>
              <div className="space-y-2">
                {(task.attachments || []).map((att) => (
                  <div key={att.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg text-sm group">
                    <Paperclip className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <button
                      onClick={() => handleDownload(att)}
                      className="flex-1 text-primary-600 hover:text-primary-700 truncate font-medium text-left"
                    >
                      {att.filename}
                    </button>
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {(att.filesize / 1024).toFixed(0)}KB
                    </span>
                    <button
                      onClick={() => deleteAttachmentMutation.mutate(att.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded text-red-500 transition-all duration-150"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {(!task.attachments || task.attachments.length === 0) && (
                  <p className="text-xs text-gray-400 text-center py-4">No attachments</p>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6 mt-4">
              <h3 className="font-semibold mb-3">Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Created by</span>
                  <span className="font-medium">{task.creator?.displayName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Created</span>
                  <span>{format(new Date(task.createdAt), 'MMM d, yyyy')}</span>
                </div>
                {task.updatedAt && task.updatedAt !== task.createdAt && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Updated</span>
                    <span>{format(new Date(task.updatedAt), 'MMM d, yyyy')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
