import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Search, FileText, FolderKanban } from 'lucide-react';
import API from '../lib/api';

export default function CommandPalette({ onClose }) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => API.get('/projects').then(r => r.data),
  });

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const projects = (projectsData || []).filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase())
  );

  const handleSelect = (path) => {
    navigate(path);
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-[20vh]"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -10 }}
          transition={{ duration: 0.15 }}
          className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 px-4 border-b border-gray-200">
            <Search className="w-5 h-5 text-gray-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects, tasks..."
              className="flex-1 py-4 text-sm outline-none bg-transparent"
            />
            <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] text-gray-500">ESC</kbd>
          </div>
          <div className="max-h-80 overflow-auto p-2">
            {query && projects.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSelect(`/projects/${p.id}`)}
                className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-left hover:bg-gray-100 rounded-lg transition-colors duration-100"
              >
                <FolderKanban className="w-4 h-4 text-primary-500" />
                <span>{p.name}</span>
                <span className="ml-auto text-xs text-gray-400">{p._count?.tasks || 0} tasks</span>
              </button>
            ))}
            {query && projects.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">No results found</p>
            )}
            {!query && (
              <p className="text-sm text-gray-400 text-center py-6">Type to search...</p>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
