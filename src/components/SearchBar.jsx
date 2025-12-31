export default function SearchBar({ value, onChange, onSearch, searching = false }) {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && value.trim() && !searching) {
      e.preventDefault();
      onSearch && onSearch(value.trim());
    }
  };

  return (
    <div className="search-bar">
      <input
        type="text"
        className="search-input"
        placeholder={searching ? '搜索中...' : '搜索歌曲或歌手'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={searching}
        aria-label="搜索歌曲"
        id="search-input"
        name="search"
      />
    </div>
  );
}
