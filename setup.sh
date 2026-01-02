#!/bin/bash
# Setup script for Apple Maps Trailer Route Search Plugin

set -e

echo "================================"
echo "Apple Maps Trailer Route Plugin"
echo "Setup Script"
echo "================================"
echo ""

# Check Python version
echo "Checking Python version..."
python3 --version

# Install dependencies
echo ""
echo "Installing Python dependencies..."
pip install -r requirements.txt

# Make CLI executable
echo ""
echo "Making CLI executable..."
chmod +x plugins/apple_maps_trailer/cli.py
chmod +x plugins/apple_maps_trailer/example.py

echo ""
echo "================================"
echo "Setup Complete!"
echo "================================"
echo ""
echo "Quick Start:"
echo ""
echo "1. Run examples:"
echo "   python3 plugins/apple_maps_trailer/example.py"
echo ""
echo "2. Search for a route:"
echo "   python3 -m plugins.apple_maps_trailer.cli \\"
echo "     --origin 'San Francisco, CA' \\"
echo "     --destination 'Los Angeles, CA' \\"
echo "     --weight 25000 --height 4.0 --width 2.4 \\"
echo "     --units metric"
echo ""
echo "3. Run Ansible playbook:"
echo "   cd playbooks && ansible-playbook route_search_example.yml"
echo ""
echo "For more information, see plugins/apple_maps_trailer/README.md"
echo ""
