import { StatusBar } from 'expo-status-bar';
import { ScrollView, Text, View, Pressable, TextInput } from 'react-native';
import WDILCard from './WDILCard';

const CardEditScreen = () => {
    return (
		<View className="flex-1 justify-start bg-[#F5EFB9] py-3 px-2">
            <StatusBar style="auto" />

            <ScrollView>
                <Text className='text-gray-950 py-3 text-lg'>When did I last...</Text>
                <TextInput
                    className='bg-white rounded-md p-3'
                    multiline={true}
                    numberOfLines={1}
                />

                <Pressable className='bg-[#82c056] rounded-md mt-4'>
                    <Text className='text-white text-center py-3 text-lg'>Save</Text>
                </Pressable>
                
                <Pressable className='border-2 border- border-red-500 rounded-md mt-4'>
                    <Text className='text-red-500 text-center py-3 text-lg'>Delete</Text>
                </Pressable>
                
            </ScrollView>
			
		</View>
    );
};

export default CardEditScreen;