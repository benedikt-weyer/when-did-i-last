import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';

const HomeScreen = () => {
    return (
		<View className="flex-1 justify-start bg-[#F5EFB9] p-5">
            <StatusBar style="auto" />

			<View className='bg-white p-3 rounded-md'>
                <Text className='text-[#111]'>Open up App.tsx to start working on the app?</Text>
            </View>
			
			
		</View>
    );
};

export default HomeScreen;