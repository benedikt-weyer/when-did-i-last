import { StatusBar } from 'expo-status-bar';
import { ScrollView, Text, View, Pressable, TextInput } from 'react-native';


const SettingsScreen = () => {


    return (
		<View className="flex-1 justify-start bg-[#F5EFB9] py-3 px-4">
            <StatusBar style="auto" />

            <ScrollView>
                <Text className='text-gray-950 py-3 text-lg'>Nothing here</Text>
                
                
            </ScrollView>
			
		</View>
    );
};

export default SettingsScreen;