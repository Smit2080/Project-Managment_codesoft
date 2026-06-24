import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import API from '../lib/api';
import toast from 'react-hot-toast';

export default function AddMemberModal({ projectId, members, onClose }) {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('member');
  const queryClient = useQueryClient();

  const addMutation = useMutation({
    mutationFn: ({ userId, role }) => API.post(`/projects/${projectId}/members`, { userId, role }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success('Member added');
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to add member'),
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="bg-white rounded-xl shadow-2xl border border-gray-200 p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">Add Member</h2>
        <p className="text-sm text-gray-500 mb-4">Enter the user ID and select a role to add them to this project.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">User ID (UUID)</label>
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="input-field"
              placeholder="Paste user UUID here"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="input-field">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => addMutation.mutate({ userId, role })}
            disabled={!userId || addMutation.isPending}
            className="btn-primary"
          >
            {addMutation.isPending ? 'Adding...' : 'Add Member'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
