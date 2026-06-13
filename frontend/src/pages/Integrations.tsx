export const Integrations = () => (
  <div className="p-6">
    <h1 className="text-2xl font-bold mb-6 text-gray-100">Integrations</h1>
    <div className="grid grid-cols-2 gap-6">
      <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
        <h2 className="font-semibold mb-2">GitHub Tracker</h2>
        <input placeholder="Repo URL (e.g., owner/repo)" className="w-full bg-gray-900 p-2 mb-2 rounded border border-gray-700" />
        <button className="bg-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-600">Connect Repo</button>
      </div>
      <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
        <h2 className="font-semibold mb-2">Voice Summary</h2>
        <p className="text-sm text-gray-400 mb-4">Trigger an AI-generated audio summary of your board.</p>
        <button className="bg-blue-600 px-4 py-2 rounded text-sm hover:bg-blue-500">🔊 Read Update</button>
      </div>
    </div>
  </div>
);
