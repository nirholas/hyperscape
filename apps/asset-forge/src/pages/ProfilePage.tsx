/**
 * Profile Page
 * User profile and account settings
 */

import { User, Mail, Shield, Bell, Palette, Key, Save } from 'lucide-react'
import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Input, Badge, Checkbox } from '@/components/common'

export function ProfilePage() {
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [browserNotifications, setBrowserNotifications] = useState(false)

  // Sample user data (will be replaced with real auth data later)
  const user = {
    name: 'John Doe',
    email: 'john.doe@example.com',
    role: 'admin',
    joinedDate: 'January 2024',
    walletAddress: '0x1234...5678'
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Header */}
      <div className="bg-bg-secondary border-b border-border-primary backdrop-blur-md">
        <div className="max-w-[1200px] mx-auto px-6 py-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/10 rounded-lg border border-primary/20 backdrop-blur-sm">
              <User className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-text-primary">Profile Settings</h1>
              <p className="text-text-secondary mt-1">Manage your account and preferences</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[1200px] mx-auto px-6 py-6 space-y-6">
        {/* Profile Information */}
        <Card className="bg-bg-secondary border-border-primary backdrop-blur-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="w-5 h-5 text-primary" />
              <CardTitle>Profile Information</CardTitle>
            </div>
            <CardDescription>Your basic account information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center border-2 border-primary/20 backdrop-blur-sm">
                <User className="w-10 h-10 text-primary" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-semibold text-text-primary">{user.name}</h3>
                  <Badge variant="default">{user.role}</Badge>
                </div>
                <p className="text-sm text-text-secondary">Member since {user.joinedDate}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary flex items-center gap-2">
                  <User className="w-4 h-4 text-primary" />
                  Display Name
                </label>
                <Input defaultValue={user.name} className="bg-bg-tertiary border-border-primary text-text-primary placeholder:text-text-tertiary" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary flex items-center gap-2">
                  <Mail className="w-4 h-4 text-primary" />
                  Email Address
                </label>
                <Input defaultValue={user.email} type="email" className="bg-bg-tertiary border-border-primary text-text-primary placeholder:text-text-tertiary" />
              </div>
            </div>

            {user.walletAddress && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary flex items-center gap-2">
                  <Key className="w-4 h-4 text-primary" />
                  Wallet Address
                </label>
                <Input value={user.walletAddress} readOnly className="bg-bg-tertiary border-border-primary text-text-secondary font-mono" />
              </div>
            )}

            <div className="flex justify-end pt-4">
              <Button variant="primary" className="gap-2">
                <Save className="w-4 h-4" />
                Save Changes
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card className="bg-bg-secondary border-border-primary backdrop-blur-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-primary" />
              <CardTitle>Notifications</CardTitle>
            </div>
            <CardDescription>Manage your notification preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg border border-border-primary">
              <div className="flex-1">
                <h4 className="text-sm font-medium text-text-primary">Email Notifications</h4>
                <p className="text-xs text-text-secondary mt-1">Receive updates about your assets and projects</p>
              </div>
              <Checkbox
                checked={emailNotifications}
                onCheckedChange={(checked) => setEmailNotifications(!!checked)}
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg border border-border-primary">
              <div className="flex-1">
                <h4 className="text-sm font-medium text-text-primary">Browser Notifications</h4>
                <p className="text-xs text-text-secondary mt-1">Get real-time alerts in your browser</p>
              </div>
              <Checkbox
                checked={browserNotifications}
                onCheckedChange={(checked) => setBrowserNotifications(!!checked)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Appearance */}
        <Card className="bg-bg-secondary border-border-primary backdrop-blur-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Palette className="w-5 h-5 text-primary" />
              <CardTitle>Appearance</CardTitle>
            </div>
            <CardDescription>Customize your workspace theme</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button className="p-4 bg-bg-tertiary rounded-lg border-2 border-primary hover:border-primary/50 transition-all">
                <div className="w-full h-16 bg-gradient-to-br from-gray-900 to-gray-800 rounded mb-3 border border-border-primary"></div>
                <p className="text-sm font-medium text-text-primary">Dark</p>
                <p className="text-xs text-text-tertiary">Classic dark theme</p>
              </button>
              <button className="p-4 bg-bg-tertiary rounded-lg border-2 border-border-primary hover:border-primary/50 transition-all">
                <div className="w-full h-16 bg-gradient-to-br from-gray-100 to-gray-200 rounded mb-3 border border-border-primary"></div>
                <p className="text-sm font-medium text-text-primary">Light</p>
                <p className="text-xs text-text-tertiary">Clean light theme</p>
              </button>
              <button className="p-4 bg-bg-tertiary rounded-lg border-2 border-border-primary hover:border-primary/50 transition-all">
                <div className="w-full h-16 bg-gradient-to-br from-gray-900 via-gray-700 to-gray-100 rounded mb-3 border border-border-primary"></div>
                <p className="text-sm font-medium text-text-primary">Auto</p>
                <p className="text-xs text-text-tertiary">Match system</p>
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Security */}
        <Card className="bg-bg-secondary border-border-primary backdrop-blur-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              <CardTitle>Security</CardTitle>
            </div>
            <CardDescription>Manage your account security settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg border border-border-primary">
              <div className="flex-1">
                <h4 className="text-sm font-medium text-text-primary">Two-Factor Authentication</h4>
                <p className="text-xs text-text-secondary mt-1">Add an extra layer of security to your account</p>
              </div>
              <Badge variant="secondary">Not enabled</Badge>
            </div>

            <div className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg border border-border-primary">
              <div className="flex-1">
                <h4 className="text-sm font-medium text-text-primary">Active Sessions</h4>
                <p className="text-xs text-text-secondary mt-1">Manage devices with access to your account</p>
              </div>
              <Button variant="ghost" size="sm">View</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
